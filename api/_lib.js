import { get, put } from '@vercel/blob';
import crypto from 'node:crypto';

const OPTS = { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN };

// This checklist began as one person's, stored at the top level of the bucket. That
// account keeps the id `owner`, so its data stays exactly where it already is — nothing
// is copied or moved — and the single passphrase it was built around still lands on it.
export const OWNER_UID = 'owner';

const statePath = (uid) => (uid === OWNER_UID ? 'state.json' : `u/${uid}/state.json`);
const inboxPath = (uid) => (uid === OWNER_UID ? 'inbox.json' : `u/${uid}/inbox.json`);

const AUTH_SECRET = (process.env.AUTH_SECRET || '').trim();
const INVITE_CODE = (process.env.INVITE_CODE || '').trim();
const LEGACY_SECRET = (process.env.APP_SECRET || '').trim();

// Signing sessions with a guessable key would let anyone mint one for any account, so
// accounts stay switched off until AUTH_SECRET is a real secret.
export const accountsReady = () => AUTH_SECRET.length >= 16;
export const invitesOpen = () => INVITE_CODE.length > 0;

export function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}
function ownerEmail() {
  return normalizeEmail(process.env.OWNER_EMAIL || '');
}
function userPath(email) {
  // Hashed, so an email address is never part of a stored path.
  return 'users/' + crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex') + '.json';
}

// Compares through a hash so the check costs the same whatever the lengths are.
function constantEq(a, b) {
  const h = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

async function readJson(pathname, fallback) {
  try {
    const r = await get(pathname, { ...OPTS, useCache: false });
    if (!r || r.statusCode !== 200) return fallback;
    const text = await new Response(r.stream).text();
    return JSON.parse(text);
  } catch (e) {
    if (e && (e.name === 'BlobNotFoundError' || /not found/i.test(e.message || ''))) return fallback;
    console.error('readJson', pathname, e);
    return fallback;
  }
}

async function writeJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    ...OPTS,
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export const getState = (uid) => readJson(statePath(uid), { days: {}, backlog: [], ideas: [] });
export const putState = (uid, v) => writeJson(statePath(uid), v);
export const getInbox = (uid) => readJson(inboxPath(uid), []);
export const putInbox = (uid, v) => writeJson(inboxPath(uid), v);

// ---------- passwords ----------
// scrypt with these parameters takes ~100ms, which is the point: it's the only thing
// standing between a leaked user record and the password behind it.
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64, SCRYPT).toString('hex');
}

export function samePassword(password, user) {
  if (!user || !user.salt || !user.hash) return false;
  const a = Buffer.from(hashPassword(password, user.salt), 'hex');
  const b = Buffer.from(String(user.hash), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function checkInvite(given) {
  return invitesOpen() && constantEq(given || '', INVITE_CODE);
}

// ---------- invitations ----------
// A code of someone's own, good once. The shared INVITE_CODE still works alongside these,
// so nothing handed out before this existed stops working.
const INVITE_INDEX = 'invites/index.json';
// No I, L, O, 0 or 1: this gets read off a screen and typed on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newInviteCode() {
  const block = () => Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  return block() + '-' + block();
}

export const getInvites = () => readJson(INVITE_INDEX, []);
export const putInvites = (v) => writeJson(INVITE_INDEX, v);

// Either the shared code or an unused personal one. Returns what was matched, so signup
// knows whether there's an invitation to spend.
export async function resolveInvite(given) {
  const raw = String(given || '').trim();
  if (!raw) return null;
  if (checkInvite(raw)) return { kind: 'shared' };
  const code = raw.toUpperCase();
  const hit = (await getInvites()).find((i) => i.code === code);
  if (!hit || hit.usedAt || hit.revokedAt) return null;
  return { kind: 'personal', code };
}

export async function markInviteUsed(code, email) {
  const invites = await getInvites();
  const hit = invites.find((i) => i.code === code);
  if (!hit) return;
  hit.usedAt = new Date().toISOString();
  hit.usedBy = email;
  await putInvites(invites);
}

// ---------- tokens ----------
// Signed rather than stored: there's no session table to keep, and a token can't be
// edited into someone else's account without the secret.
const SESSION_DAYS = 90;

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
}

function readToken(token) {
  if (!accountsReady()) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expect = crypto.createHmac('sha256', AUTH_SECRET).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch (e) { return null; }
  if (!payload || !payload.u) return null;
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

export const sessionToken = (user) =>
  signToken({ u: user.id, e: user.email || null, k: 's', exp: Date.now() + SESSION_DAYS * 86400000 });

// No expiry: an agent posting from a cron job can't come back and sign in again.
export const apiToken = (user) => signToken({ u: user.id, e: user.email || null, k: 'a' });

// ---------- users ----------
export const isOwner = (uid) => uid === OWNER_UID;

export const findUser = (email) => readJson(userPath(email), null);

export async function createUser(email, password) {
  const clean = normalizeEmail(email);
  const owner = ownerEmail();
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    // Claiming the owner id is how the original list becomes this account's list.
    id: owner && clean === owner ? OWNER_UID : crypto.randomBytes(9).toString('hex'),
    email: clean,
    salt,
    hash: hashPassword(password, salt),
    created: new Date().toISOString(),
  };
  await writeJson(userPath(clean), user);
  return user;
}

// ---------- request auth ----------
// Three credentials can turn up: a session token from the app, a long-lived API token an
// agent was handed, and the original single-user passphrase — which still works, and still
// means the owner's list, so nothing set up before accounts existed has to change.
export function authorize(req) {
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const q = (req.query && (req.query.k || req.query.key)) || '';
  const given = (bearer || q || '').trim();
  if (!given) return null;

  if (LEGACY_SECRET && constantEq(given.toLowerCase(), LEGACY_SECRET.toLowerCase())) {
    return { userId: OWNER_UID, email: null, kind: 'legacy' };
  }

  const payload = readToken(given);
  if (!payload) return null;
  return { userId: payload.u, email: payload.e || null, kind: payload.k === 'a' ? 'api' : 'session' };
}

// What the app shows in its header, and what it uses to decide whose board it is.
export function accountFor(auth) {
  return {
    email: auth.email,
    isOwner: isOwner(auth.userId),
    // Echoed to the app so a signed-in browser can always show the agent token, on any
    // device, without it having to be stored anywhere but the account itself. Withheld
    // when there's no secret to sign it with: a token nothing would accept is worse than
    // no token at all.
    apiToken: auth.kind === 'api' || !accountsReady()
      ? null
      : apiToken({ id: auth.userId, email: auth.email }),
  };
}

export function newId() {
  return 'x-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
