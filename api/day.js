import { authorize, getInbox, putInbox, readBody } from './_lib.js';

// POST /api/day
// Body: { date?: "YYYY-MM-DD", category?: "work"|"personal",
//         items: (string | { text, category?, date? })[] }
// Queues priorities that the app merges into the given day on its next sync.
export default async function handler(req, res) {
  if (!authorize(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const body = await readBody(req);
    const defaultDate = body.date || new Date().toISOString().slice(0, 10);
    const defaultCat = body.category === 'personal' ? 'personal' : 'work';

    const rawItems = Array.isArray(body.items) ? body.items
      : (body.text ? [body.text] : []);

    const queued = [];
    for (const it of rawItems) {
      const obj = typeof it === 'string' ? { text: it } : (it || {});
      if (!obj.text || !String(obj.text).trim()) continue;
      queued.push({
        text: String(obj.text).trim().slice(0, 500),
        category: obj.category === 'personal' ? 'personal' : (it && it.category ? 'work' : defaultCat),
        date: obj.date || defaultDate,
      });
    }

    if (!queued.length) {
      res.status(400).json({ error: 'no valid items' });
      return;
    }

    const inbox = await getInbox();
    const next = (Array.isArray(inbox) ? inbox : []).concat(queued);
    await putInbox(next);

    res.status(200).json({ ok: true, queued: queued.length });
  } catch (e) {
    console.error('day error', e);
    res.status(500).json({ error: 'server error' });
  }
}
