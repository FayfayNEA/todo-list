import { authorize, getState, getNotionMap } from './_lib.js';
import { notionReady, markedTasks, syncMarked, weekLabel } from './_notion.js';

// GET  /api/notion-sync  -> what is starred, and what Notion already knows about it.
//                           Reads nothing from Notion, so it answers before a token is
//                           set and is the quick way to check the stars are where you
//                           think they are.
// POST /api/notion-sync  -> push every starred task again, changed or not. For the
//                           first run, and for picking up after Notion was down.
export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const state = await getState(auth.userId);

    if (req.method === 'GET') {
      const map = await getNotionMap(auth.userId);
      const known = map.tasks || {};
      res.status(200).json({
        configured: notionReady(),
        tasks: markedTasks(state).map((t) => ({
          text: t.text,
          date: t.date,
          week: weekLabel(t.date),
          done: t.done,
          inNotion: !!known[t.id],
        })),
      });
      return;
    }

    if (req.method === 'POST') {
      if (!notionReady()) {
        res.status(503).json({ error: 'NOTION_TOKEN and NOTION_BACKLOG_DB are not set' });
        return;
      }
      res.status(200).json(await syncMarked(auth.userId, state, { force: true }));
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('notion-sync error', e);
    res.status(500).json({ error: 'server error' });
  }
}
