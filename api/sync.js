import { authorize, accountFor, getState, putState, getInbox, putInbox, newId, readBody } from './_lib.js';

// GET  /api/sync  -> drains the agent inbox into the day map, returns { days, backlog, ideas }
// PUT  /api/sync  -> replaces stored state with the posted { days, backlog, ideas }

function storedIdeas(state) {
  if (Array.isArray(state && state.ideas)) return state.ideas;
  if (Array.isArray(state && state.likes)) return state.likes;
  return [];
}
export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const uid = auth.userId;

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

      res.status(200).json({
        days: state.days || {},
        backlog: state.backlog || [],
        // `likes` was this list's original key; read it forward so nothing is lost.
        ideas: storedIdeas(state),
        // Who this token belongs to: the app shows it, and uses it to tell whose
        // board it is looking at.
        account: accountFor(auth),
      });
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      const days = body && typeof body.days === 'object' && body.days ? body.days : {};
      const backlog = Array.isArray(body && body.backlog) ? body.backlog : [];
      // A client running older JS omits the key entirely; keep what's stored rather
      // than letting a stale tab wipe the list.
      const ideas = Array.isArray(body && body.ideas)
        ? body.ideas
        : storedIdeas(await getState(uid));
      await putState(uid, { days, backlog, ideas });
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
