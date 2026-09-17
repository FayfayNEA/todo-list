import {
  authorize, normalizeEmail, findUser, getShares, putShares, sharedByMe, sharedWithMe,
} from './_lib.js';

// GET    /api/share             -> { sharingWith: [...], sharedWithMe: [...] }
// POST   /api/share { email }   -> hand that person your day
// DELETE /api/share { email }   -> take it back
//
// A grant only ever goes outwards: you say who may open your board. Nobody can ask for a
// look at someone else's, so an address alone is never enough to read a stranger's day.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_SHARES = 25;

async function readBodyJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    if (req.method === 'GET') {
      res.status(200).json({ sharingWith: await sharedByMe(auth), sharedWithMe: await sharedWithMe(auth) });
      return;
    }

    if (req.method === 'POST' || req.method === 'DELETE') {
      // The passphrase carries no address, so there is no "me" for the other person's
      // list to name, and nothing to show them who let them in.
      if (!auth.email) {
        res.status(403).json({ error: 'make an account with an email before sharing your day' });
        return;
      }
      const body = await readBodyJson(req);
      const email = normalizeEmail(body.email);
      if (!EMAIL_RE.test(email)) {
        res.status(400).json({ error: "that doesn't look like an email address" });
        return;
      }
      if (email === normalizeEmail(auth.email)) {
        res.status(400).json({ error: 'that is your own address' });
        return;
      }

      const shares = await getShares();
      const mine = (s) => s.ownerUid === auth.userId && normalizeEmail(s.granteeEmail) === email;

      if (req.method === 'DELETE') {
        let found = false;
        for (const s of shares) {
          if (mine(s) && !s.revokedAt) { s.revokedAt = new Date().toISOString(); found = true; }
        }
        if (found) await putShares(shares);
        res.status(200).json({ ok: true, sharingWith: await sharedByMe(auth) });
        return;
      }

      if (shares.some((s) => mine(s) && !s.revokedAt)) {
        res.status(200).json({ ok: true, sharingWith: await sharedByMe(auth) });
        return;
      }
      if (shares.filter((s) => s.ownerUid === auth.userId && !s.revokedAt).length >= MAX_SHARES) {
        res.status(409).json({ error: 'that is as many people as one board can be shared with' });
        return;
      }
      // Sharing with someone who hasn't signed up yet is allowed: the grant is matched by
      // address, so it starts working the moment they make an account with it.
      const pending = !(await findUser(email));
      shares.push({
        ownerUid: auth.userId,
        ownerEmail: normalizeEmail(auth.email),
        granteeEmail: email,
        createdAt: new Date().toISOString(),
      });
      await putShares(shares);
      res.status(200).json({ ok: true, pending, sharingWith: await sharedByMe(auth) });
      return;
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('share error', e);
    res.status(500).json({ error: 'server error' });
  }
}
