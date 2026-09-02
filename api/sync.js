import { authorize, getState, putState, getInbox, putInbox, newId, readBody } from './_lib.js';

// GET  /api/sync  -> drains the agent inbox into the day map, returns { days, backlog }
// PUT  /api/sync  -> replaces stored state with the posted { days, backlog }
export default async function handler(req, res) {
  if (!authorize(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const state = await getState();
      const inbox = await getInbox();

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
        await putState(state);
        await putInbox([]);
      }

      res.status(200).json({ days: state.days || {}, backlog: state.backlog || [] });
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      const days = body && typeof body.days === 'object' && body.days ? body.days : {};
      const backlog = Array.isArray(body && body.backlog) ? body.backlog : [];
      await putState({ days, backlog });
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
