import {
  accountsReady, invitesOpen, resolveInvite, markInviteUsed, normalizeEmail,
  findUser, createUser, samePassword, sessionToken, apiToken, isOwner, readBody,
  authorize, ownerClaim, saveUser,
} from './_lib.js';
import QRCode from 'qrcode';
import { newSecret, checkCode, newBackupCodes, hashBackup, otpauthUrl } from './_totp.js';

// POST /api/auth
// Body: { action: "signup" | "login" | "claim", email, password, invite?, code? }
//
// Two-step sign-in, for a signed-in account (session token):
//   { action: "2fa_status" }            -> { on }
//   { action: "2fa_setup" }             -> { secret, otpauth, qr }  a pending secret to scan
//   { action: "2fa_enable", code }      -> { backupCodes }          shown this once
//   { action: "2fa_disable", code }     a current code or a backup code
// With it on, "login" needs `code` as well; without it the answer is { need2fa: true }.
//
// "claim" is for a browser still signed in with the original passphrase: it gives the
// original list an email and password, so it can be opened anywhere. Nothing in the list
// is read or written; only the account record that points at it is made.
// Returns: { token, account: { email, isOwner, apiToken } }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;

function signedIn(user) {
  return {
    token: sessionToken(user),
    account: { email: user.email, isOwner: isOwner(user.id), apiToken: apiToken(user) },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (!accountsReady()) {
    res.status(503).json({ error: 'accounts are not set up on this server yet' });
    return;
  }

  try {
    const body = await readBody(req);
    if (String(body.action || '').startsWith('2fa_')) { await twoFactor(req, res, body); return; }
    const action = body.action === 'signup' ? 'signup' : 'login';
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "that doesn't look like an email address" });
      return;
    }

    if (body.action === 'claim') {
      const auth = authorize(req);
      if (!auth || auth.kind !== 'legacy') {
        res.status(403).json({ error: 'only a browser signed in with the passphrase can do this' });
        return;
      }
      if (await ownerClaim()) {
        res.status(409).json({ error: 'this list already has an email account, sign in with that instead' });
        return;
      }
      if (password.length < MIN_PASSWORD) {
        res.status(400).json({ error: `pick a password of at least ${MIN_PASSWORD} characters` });
        return;
      }
      if (await findUser(email)) {
        res.status(409).json({ error: 'that email already has an account of its own' });
        return;
      }
      const user = await createUser(email, password, { claimOwner: true });
      res.status(200).json(signedIn(user));
      return;
    }

    if (action === 'signup') {
      // Anyone can make an account. An invitation link still works and is marked used,
      // but it's no longer the door. SIGNUP_CLOSED=1 shuts it again without a deploy,
      // leaving invitations as the only way in, which is how this started.
      const invite = await resolveInvite(body.invite);
      if (!invite && process.env.SIGNUP_CLOSED === '1') {
        if (!invitesOpen()) { res.status(503).json({ error: 'new accounts are closed right now' }); return; }
        res.status(403).json({ error: "that invite code isn't right, or it's already been used" });
        return;
      }
      if (password.length < MIN_PASSWORD) {
        res.status(400).json({ error: `pick a password of at least ${MIN_PASSWORD} characters` });
        return;
      }
      if (await findUser(email)) {
        res.status(409).json({ error: 'there is already an account with that email, sign in instead' });
        return;
      }
      const user = await createUser(email, password);
      if (invite && invite.kind === 'personal') await markInviteUsed(invite.code, email);
      res.status(200).json(signedIn(user));
      return;
    }

    const user = await findUser(email);
    // One message for both halves: which of the two was wrong is not the caller's business.
    if (!user || !samePassword(password, user)) {
      res.status(401).json({ error: "that email and password don't match" });
      return;
    }
    if (user.twoFactor && user.twoFactor.secret) {
      const tf = user.twoFactor;
      if (tf.lockedUntil && tf.lockedUntil > Date.now()) {
        const mins = Math.ceil((tf.lockedUntil - Date.now()) / 60000);
        res.status(429).json({ need2fa: true, error: `too many wrong codes. try again in ${mins} minute${mins === 1 ? '' : 's'}` });
        return;
      }
      if (!body.code) {
        res.status(401).json({ need2fa: true, error: 'enter the 6-digit code from your authenticator app' });
        return;
      }
      if (!passSecondStep(tf, body.code)) {
        // Six digits can be guessed given long enough, so five wrong in a row locks the
        // door for a quarter of an hour.
        tf.fails = (tf.fails || 0) + 1;
        if (tf.fails >= 5) { tf.fails = 0; tf.lockedUntil = Date.now() + 15 * 60000; }
        await saveUser(user);
        res.status(401).json({ need2fa: true, error: "that code isn't right" });
        return;
      }
      tf.fails = 0;
      delete tf.lockedUntil;
      await saveUser(user);
    }
    res.status(200).json(signedIn(user));
  } catch (e) {
    console.error('auth error', e);
    res.status(500).json({ error: 'server error' });
  }
}

// A current code (never the same window twice), or one of the backup codes, used up.
function passSecondStep(tf, code) {
  const w = checkCode(tf.secret, code, tf.lastWindow ?? -1);
  if (w != null) { tf.lastWindow = w; return true; }
  const h = hashBackup(code);
  const i = (tf.backup || []).indexOf(h);
  if (i >= 0 && String(code).replace(/[^a-z0-9]/gi, '').length === 10) { tf.backup.splice(i, 1); return true; }
  return false;
}

async function twoFactor(req, res, body) {
  const auth = authorize(req);
  // Needs a real account: the passphrase and agent tokens have nobody to attach it to.
  if (!auth || auth.kind !== 'session' || !auth.email) {
    res.status(403).json({ error: 'sign in with your email first' });
    return;
  }
  const user = await findUser(auth.email);
  if (!user || user.id !== auth.userId) { res.status(404).json({ error: 'no such account' }); return; }
  const on = !!(user.twoFactor && user.twoFactor.secret);

  if (body.action === '2fa_status') {
    res.status(200).json({ on, backupLeft: on ? (user.twoFactor.backup || []).length : 0 });
    return;
  }
  if (body.action === '2fa_setup') {
    if (on) { res.status(409).json({ error: "it's already on" }); return; }
    const secret = newSecret();
    user.twoFactorPending = { secret, at: Date.now() };
    await saveUser(user);
    const otpauth = otpauthUrl(secret, user.email);
    const qr = await QRCode.toString(otpauth, { type: 'svg', margin: 1, width: 180 });
    res.status(200).json({ secret, otpauth, qr });
    return;
  }
  if (body.action === '2fa_enable') {
    const pending = user.twoFactorPending;
    // A setup left open for a day has gone stale; start again rather than trust it.
    if (!pending || Date.now() - pending.at > 24 * 3600 * 1000) { res.status(400).json({ error: 'start again: scan a fresh code' }); return; }
    const w = checkCode(pending.secret, body.code);
    if (w == null) { res.status(400).json({ error: "that code isn't right. check the app and try the newest one" }); return; }
    const backupCodes = newBackupCodes();
    user.twoFactor = { secret: pending.secret, lastWindow: w, backup: backupCodes.map(hashBackup), since: new Date().toISOString() };
    delete user.twoFactorPending;
    await saveUser(user);
    res.status(200).json({ ok: true, backupCodes });
    return;
  }
  if (body.action === '2fa_disable') {
    if (!on) { res.status(200).json({ ok: true }); return; }
    if (!passSecondStep(user.twoFactor, body.code)) { res.status(400).json({ error: "that code isn't right" }); return; }
    delete user.twoFactor;
    await saveUser(user);
    res.status(200).json({ ok: true });
    return;
  }
  res.status(400).json({ error: 'unknown action' });
}
