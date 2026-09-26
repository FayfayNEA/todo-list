import {
  authorize, mayOpen, getComments, putComments, newCommentId, normalizeEmail, readBody,
  getProfiles,
} from './_lib.js';

// GET    /api/comments?uid=&date=   -> the notes left on that board
// POST   /api/comments?uid=  { date, text, taskId?, kind? }   kind: note | step
// DELETE /api/comments?uid=  { id }
//
// A guest reads a shared day and says what they would change. Only the owner can act on
// it, which is the whole point: the list stays theirs, and the note is a suggestion
// sitting next to it rather than an edit that already happened.
const MAX_TEXT = 600;
const MAX_PER_BOARD = 400;

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const asked = (req.query && (req.query.uid || req.query.u)) || '';
  const uid = asked ? String(asked) : auth.userId;
  const owner = uid === auth.userId;
  if (!owner && !(await mayOpen(auth, uid))) {
    res.status(403).json({ error: 'that board has not been shared with you' });
    return;
  }

  try {
    const all = await getComments(uid);

    if (req.method === 'GET') {
      const date = (req.query && req.query.date) || '';
      const list = (date ? all.filter((c) => c.date === String(date)) : all)
        .map((c) => ({ ...c, mine: isAuthor(c, auth) }));
      res.status(200).json({ comments: list });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const text = String((body && body.text) || '').trim().slice(0, MAX_TEXT);
      const date = String((body && body.date) || '').slice(0, 10);
      if (!text) {
        res.status(400).json({ error: 'write something first' });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: 'which day is this about?' });
        return;
      }
      if (all.length >= MAX_PER_BOARD) {
        res.status(409).json({ error: 'that board has as many notes as it can hold' });
        return;
      }
      const comment = {
        id: newCommentId(),
        date,
        // Optional: a note can point at one task rather than the day as a whole.
        taskId: body && body.taskId ? String(body.taskId).slice(0, 64) : null,
        text,
        // A note is something to read; a step is a suggestion the owner can add to the
        // task with one tap.
        kind: body && body.kind === 'step' && body.taskId ? 'step' : 'note',
        // Stored rather than looked up later, so a note still says who wrote it after a
        // share is taken back. The name is what people see; the email and id are what
        // decide who may take it back.
        author: normalizeEmail(auth.email) || 'someone',
        authorUid: auth.userId,
        authorName: ((await getProfiles())[auth.userId] || {}).name || normalizeEmail(auth.email) || 'someone',
        createdAt: new Date().toISOString(),
      };
      all.push(comment);
      await putComments(uid, all);
      res.status(200).json({ ok: true, comment: { ...comment, mine: true } });
      return;
    }

    if (req.method === 'DELETE') {
      const body = await readBody(req);
      const id = String((body && body.id) || '');
      const hit = all.find((c) => c.id === id);
      if (!hit) {
        res.status(404).json({ error: 'no such note' });
        return;
      }
      // The owner clears anything on their board; everyone else only their own words.
      if (!owner && !isAuthor(hit, auth)) {
        res.status(403).json({ error: 'that note is not yours to delete' });
        return;
      }
      await putComments(uid, all.filter((c) => c.id !== id));
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('comments error', e);
    res.status(500).json({ error: 'server error' });
  }
}

function isAuthor(c, auth) {
  if (c.authorUid) return c.authorUid === auth.userId;
  return !!auth.email && c.author === normalizeEmail(auth.email);
}
