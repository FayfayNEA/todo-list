import { get, put } from '@vercel/blob';

const OPTS = { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN };
const STATE_PATH = 'state.json';
const INBOX_PATH = 'inbox.json';

export function authorize(req) {
  const secret = (process.env.APP_SECRET || '').trim().toLowerCase();
  if (!secret) return false;
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const q = (req.query && (req.query.k || req.query.key)) || '';
  const given = (bearer || q || '').trim().toLowerCase();
  return given.length > 0 && given === secret;
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

export const getState = () => readJson(STATE_PATH, { days: {}, backlog: [] });
export const putState = (v) => writeJson(STATE_PATH, v);
export const getInbox = () => readJson(INBOX_PATH, []);
export const putInbox = (v) => writeJson(INBOX_PATH, v);

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
