import {
  authorize, accountFor, getState, putState, getInbox, putInbox, newId, readBody,
  mayOpen, workOnly, followerMaySee,
} from './_lib.js';

// GET  /api/sync[?uid=]  -> drains the agent inbox into the day map, returns the whole state
// PUT  /api/sync[?uid=]  -> replaces stored state with the posted { days, backlog, ideas, quotes, manifesto, checkins }
//
// `uid` opens somebody else's board, and only one they handed over. A guest reads the
// work half of it and nothing else, and cannot write to it at all: what they can do is
// leave a note on it, which is /api/comments. The filtering lives here rather than in the
// page, so a borrowed token can't reach past it either.

function storedIdeas(state) {
  if (Array.isArray(state && state.ideas)) return state.ideas;
  if (Array.isArray(state && state.likes)) return state.likes;
  return [];
}
function storedQuotes(state) {
  return Array.isArray(state && state.quotes) ? state.quotes : [];
}
function storedManifesto(state) {
  return Array.isArray(state && state.manifesto) ? state.manifesto : [];
}
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function storedCheckins(state) {
  return isMap(state && state.checkins) ? state.checkins : {};
}
export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const asked = (req.query && (req.query.uid || req.query.u)) || '';
  const uid = asked ? String(asked) : auth.userId;
  const guest = uid !== auth.userId;
  // Someone who shows their stickers but not their day can still be looked at: the board
  // opens with its arrangement and an empty list.
  const dayVisible = !guest || (await mayOpen(auth, uid));
  if (!dayVisible && !(await followerMaySee(auth.userId, uid, 'showStickers'))) {
    // Same answer whether the board doesn't exist or simply wasn't shared.
    res.status(403).json({ error: 'that board has not been shared with you' });
    return;
  }
  if (!dayVisible && req.method === 'GET') {
    res.status(200).json({ ...workOnly({}), account: accountFor(auth), board: { uid, guest: true } });
    return;
  }

  try {
    if (req.method === 'GET') {
      const state = await getState(uid);
      const inbox = await getInbox(uid);

      if (Array.isArray(inbox) && inbox.length) {
        state.days = state.days || {};
        for (const entry of inbox) {
          if (!entry || !entry.text) continue;
          const date = entry.date || new Date().toISOString().slice(0, 10);
          if (!state.days[date]) state.days[date] = [];
          state.days[date].push({
            id: newId(),
            text: String(entry.text).slice(0, 500),
            done: false,
            category: entry.category === 'personal' ? 'personal' : 'work',
          });
        }
        await putState(uid, state);
        await putInbox(uid, []);
      }

      if (guest) {
        res.status(200).json({ ...workOnly(state), account: accountFor(auth), board: { uid, guest: true } });
        return;
      }

      res.status(200).json({
        days: state.days || {},
        backlog: state.backlog || [],
        // `likes` was this list's original key; read it forward so nothing is lost.
        ideas: storedIdeas(state),
        quotes: storedQuotes(state),
        manifesto: storedManifesto(state),
        checkins: storedCheckins(state),
        // Who this token belongs to: the app shows it, and uses it to tell whose
        // board it is looking at.
        account: accountFor(auth),
        board: { uid, guest: false },
      });
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      if (guest) {
        // Only the owner rearranges their own day. A guest who wants something moved says
        // so in a comment.
        res.status(403).json({ error: 'this board is read-only, leave a note instead' });
        return;
      }

      const body = await readBody(req);
      const days = body && typeof body.days === 'object' && body.days ? body.days : {};
      const backlog = Array.isArray(body && body.backlog) ? body.backlog : [];
      // A client running older JS omits the key entirely; keep what's stored rather
      // than letting a stale tab wipe the list.
      const needStored = !Array.isArray(body && body.ideas) || !Array.isArray(body && body.quotes)
        || !Array.isArray(body && body.manifesto) || !isMap(body && body.checkins);
      const stored = needStored ? await getState(uid) : null;
      const ideas = Array.isArray(body && body.ideas) ? body.ideas : storedIdeas(stored);
      const quotes = Array.isArray(body && body.quotes) ? body.quotes : storedQuotes(stored);
      const manifesto = Array.isArray(body && body.manifesto) ? body.manifesto : storedManifesto(stored);
      const checkins = isMap(body && body.checkins) ? body.checkins : storedCheckins(stored);
      await putState(uid, { days, backlog, ideas, quotes, manifesto, checkins });
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'GET, PUT');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('sync error', e);
    res.status(500).json({ error: 'server error' });
  }
}
