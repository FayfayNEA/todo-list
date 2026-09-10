import {
  accountsReady, invitesOpen, checkInvite, normalizeEmail,
  findUser, createUser, samePassword, sessionToken, apiToken, isOwner, readBody,
} from './_lib.js';

// POST /api/auth
// Body: { action: "signup" | "login", email, password, invite? }
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
    const action = body.action === 'signup' ? 'signup' : 'login';
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "that doesn't look like an email address" });
      return;
    }

    if (action === 'signup') {
      if (!invitesOpen()) {
        res.status(503).json({ error: 'new accounts are closed right now' });
        return;
      }
      if (!checkInvite(body.invite)) {
        res.status(403).json({ error: "that invite code isn't right" });
        return;
      }
      if (password.length < MIN_PASSWORD) {
        res.status(400).json({ error: `pick a password of at least ${MIN_PASSWORD} characters` });
        return;
      }
      if (await findUser(email)) {
        res.status(409).json({ error: 'there is already an account with that email — sign in instead' });
        return;
      }
      res.status(200).json(signedIn(await createUser(email, password)));
      return;
    }

    const user = await findUser(email);
    // One message for both halves: which of the two was wrong is not the caller's business.
    if (!user || !samePassword(password, user)) {
      res.status(401).json({ error: "that email and password don't match" });
      return;
    }
    res.status(200).json(signedIn(user));
  } catch (e) {
    console.error('auth error', e);
    res.status(500).json({ error: 'server error' });
  }
}
