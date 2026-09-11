import {
  authorize, accountsReady, isOwner, normalizeEmail,
  newInviteCode, getInvites, putInvites, readBody,
} from './_lib.js';
import { sendInvite, mailReady } from './_mail.js';

// GET    /api/invite            -> every invitation this list has handed out
// POST   /api/invite { email }  -> makes one, and emails it if mail is set up
// DELETE /api/invite { code }   -> revokes an unused one
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_OPEN = 40;

function linkFor(req, code) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/?invite=${encodeURIComponent(code)}`;
}

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!accountsReady()) { res.status(503).json({ error: 'accounts are not set up on this server yet' }); return; }
  // Inviting grows the list of people using this deployment, which is the owner's call.
  if (!isOwner(auth.userId)) { res.status(403).json({ error: 'only the owner can invite people' }); return; }

  try {
    if (req.method === 'GET') {
      res.status(200).json({ invites: await getInvites(), mailReady: mailReady() });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const email = normalizeEmail(body.email);
      if (!EMAIL_RE.test(email)) {
        res.status(400).json({ error: "that doesn't look like an email address" });
        return;
      }
      const invites = await getInvites();
      if (invites.filter((i) => !i.usedAt && !i.revokedAt).length >= MAX_OPEN) {
        res.status(409).json({ error: 'there are a lot of unused invitations already — revoke some first' });
        return;
      }
      const code = newInviteCode();
      const invite = { code, email, created: new Date().toISOString(), createdBy: auth.email || null };
      invites.unshift(invite);
      await putInvites(invites);

      const link = linkFor(req, code);
      // Saved before it's sent: an invitation that exists but didn't get delivered can be
      // copied by hand, whereas one that vanished on a mail error is just gone.
      const out = await sendInvite(email, code, link, auth.email);
      if (out.sent) {
        invite.emailedAt = new Date().toISOString();
        await putInvites(invites);
      }
      res.status(200).json({ invite, link, sent: out.sent, reason: out.reason || null });
      return;
    }

    if (req.method === 'DELETE') {
      const body = await readBody(req);
      const code = String(body.code || '').trim().toUpperCase();
      const invites = await getInvites();
      const hit = invites.find((i) => i.code === code);
      if (!hit) { res.status(404).json({ error: 'no such invitation' }); return; }
      if (hit.usedAt) { res.status(409).json({ error: 'that one has already been used' }); return; }
      hit.revokedAt = new Date().toISOString();
      await putInvites(invites);
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('invite error', e);
    res.status(500).json({ error: 'server error' });
  }
}
