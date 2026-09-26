import {
  authorize, getProfiles, putProfiles, getFollows, putFollows, getStickers, putStickers,
  followerMaySee, getState, readBody, getAsks, putAsks, getSessions, putSessions, newId,
} from './_lib.js';

// GET  /api/people                     -> your profile, requests, followers, following
// GET  /api/people?q=name              -> people whose name matches
// GET  /api/people?group=1&date=       -> the work day of everyone you follow who shows it
// GET  /api/people?stickers=<uid>      -> someone's sticker board, if they show it to you
// PUT  /api/people { name?, showDay?, showStickers?, stickers? }
// POST /api/people { action: follow | unfollow | approve | deny | remove, uid }
// POST /api/people { action: ask, uid, date, text }          ask to add to their day
// POST /api/people { action: ask_done, id }                  you added it, or said no
// POST /api/people { action: session_new, title, uids }      start a collab session
// POST /api/people { action: session_note, id, text }        write in one
// POST /api/people { action: session_unnote, id, noteId }    take your note back
// POST /api/people { action: session_leave, id }
//
// Nothing is visible to anyone until its owner switches it on, and even then only to
// followers they've approved. A search result is a name and nothing else.
const MAX_NAME = 40;
const MAX_STICKERS = 200;

const nameOf = (profiles, uid, fallback) =>
  (profiles[uid] && profiles[uid].name) || fallback || 'someone';

const isWork = (t) => t && t.category !== 'personal';
const MAX_TEXT = 600;
const cleanText = (v) => String(v || '').trim().slice(0, MAX_TEXT);

// Your group: anyone either of you has approved. Sessions are only started inside it.
function groupOf(follows, me) {
  const out = new Set();
  for (const f of follows) {
    if (f.status !== 'approved') continue;
    if (f.from === me) out.add(f.to);
    if (f.to === me) out.add(f.from);
  }
  return out;
}

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const me = auth.userId;

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const profiles = await getProfiles();
      const follows = await getFollows();
      const statusWith = (uid) => {
        const f = follows.find((x) => x.from === me && x.to === uid);
        return f ? f.status : 'none';
      };

      if (q.q != null) {
        const term = String(q.q).trim().toLowerCase();
        if (term.length < 2) { res.status(200).json({ results: [] }); return; }
        const results = Object.entries(profiles)
          .filter(([uid, p]) => uid !== me && p.name && p.name.toLowerCase().includes(term))
          .slice(0, 20)
          .map(([uid, p]) => ({ uid, name: p.name, status: statusWith(uid) }));
        res.status(200).json({ results });
        return;
      }

      if (q.group) {
        const date = String(q.date || '').slice(0, 10);
        const approved = follows.filter((f) => f.from === me && f.status === 'approved')
          .map((f) => f.to)
          .filter((uid) => profiles[uid] && profiles[uid].showDay);
        const group = await Promise.all(approved.map(async (uid) => {
          const state = await getState(uid);
          const day = (state && state.days && state.days[date]) || [];
          return {
            uid,
            name: nameOf(profiles, uid),
            // Only the work half, and only what's actually on that day, not what rolled on.
            tasks: day.filter((t) => isWork(t) && !t.movedTo).map((t) => ({ text: t.text, done: !!t.done })),
            backlog: ((state && state.backlog) || []).filter(isWork).map((t) => ({ text: t.text })),
          };
        }));
        res.status(200).json({ date, group });
        return;
      }

      if (q.stickers) {
        const uid = String(q.stickers);
        if (!(await followerMaySee(me, uid, 'showStickers'))) {
          res.status(403).json({ error: "they haven't shared their stickers with you" });
          return;
        }
        res.status(200).json({ uid, name: nameOf(profiles, uid), stickers: await getStickers(uid) });
        return;
      }

      const mine = profiles[me] || {};
      const person = (uid, fallback) => {
        const p = profiles[uid] || {};
        return { uid, name: nameOf(profiles, uid, fallback), showDay: !!p.showDay, showStickers: !!p.showStickers };
      };
      const asks = await getAsks();
      const sessions = (await getSessions()).filter((x) => x.members.includes(me));
      res.status(200).json({
        me: { name: mine.name || '', showDay: !!mine.showDay, showStickers: !!mine.showStickers },
        asks: asks.filter((a) => a.to === me).map((a) => ({ ...a, fromName: nameOf(profiles, a.from, a.fromEmail) })),
        sessions: sessions.map((x) => ({
          ...x,
          memberNames: x.members.map((u) => (u === me ? 'you' : nameOf(profiles, u))),
          notes: x.notes.map((n) => ({ ...n, byName: n.by === me ? 'you' : nameOf(profiles, n.by), mine: n.by === me })),
        })),
        requests: follows.filter((f) => f.to === me && f.status === 'pending').map((f) => person(f.from, f.fromEmail)),
        followers: follows.filter((f) => f.to === me && f.status === 'approved').map((f) => person(f.from, f.fromEmail)),
        following: follows.filter((f) => f.from === me).map((f) => ({ ...person(f.to), status: f.status })),
      });
      return;
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const profiles = await getProfiles();
      const p = { ...(profiles[me] || {}) };
      if (body.name != null) {
        const name = String(body.name).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
        if (name) p.name = name; else delete p.name;
      }
      if (body.showDay != null) p.showDay = !!body.showDay;
      if (body.showStickers != null) p.showStickers = !!body.showStickers;
      profiles[me] = p;
      await putProfiles(profiles);
      if (Array.isArray(body.stickers)) await putStickers(me, body.stickers.slice(0, MAX_STICKERS));
      res.status(200).json({ ok: true, me: { name: p.name || '', showDay: !!p.showDay, showStickers: !!p.showStickers } });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const uid = String(body.uid || '');
      const action = String(body.action || '');

      if (action === 'ask') {
        const text = cleanText(body.text);
        const date = String(body.date || '').slice(0, 10);
        if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: 'say what, and for which day' }); return; }
        if (!uid || uid === me || !(await followerMaySee(me, uid, 'showDay'))) {
          res.status(403).json({ error: "you can only ask people whose day you can see" });
          return;
        }
        const asks = await getAsks();
        if (asks.filter((a) => a.to === uid).length >= 100) { res.status(409).json({ error: 'they have a lot waiting already' }); return; }
        asks.push({ id: newId(), from: me, fromEmail: auth.email || null, to: uid, date, text, at: new Date().toISOString() });
        await putAsks(asks);
        res.status(200).json({ ok: true });
        return;
      }
      if (action === 'ask_done') {
        // The page adds the task through its own save, so the list it holds can't later
        // overwrite a copy written here behind its back. This only clears the request.
        const asks = await getAsks();
        await putAsks(asks.filter((a) => !(a.id === body.id && a.to === me)));
        res.status(200).json({ ok: true });
        return;
      }

      if (action.startsWith('session_')) {
        let sessions = await getSessions();
        if (action === 'session_new') {
          const group = groupOf(await getFollows(), me);
          const uids = [...new Set((Array.isArray(body.uids) ? body.uids : []).map(String))].filter((u) => group.has(u));
          if (!uids.length) { res.status(400).json({ error: 'pick someone from your group' }); return; }
          const session = {
            id: newId(), title: cleanText(body.title).slice(0, 80) || 'collab session',
            members: [me, ...uids], createdBy: me, at: new Date().toISOString(), notes: [],
          };
          sessions.push(session);
          await putSessions(sessions);
          res.status(200).json({ ok: true, id: session.id });
          return;
        }
        const session = sessions.find((x) => x.id === body.id && x.members.includes(me));
        if (!session) { res.status(404).json({ error: 'no such session' }); return; }
        if (action === 'session_note') {
          const text = cleanText(body.text);
          if (!text) { res.status(400).json({ error: 'write something' }); return; }
          if (session.notes.length >= 500) { res.status(409).json({ error: 'this session is full' }); return; }
          session.notes.push({ id: newId(), by: me, text, at: new Date().toISOString() });
        } else if (action === 'session_unnote') {
          session.notes = session.notes.filter((n) => !(n.id === body.noteId && n.by === me));
        } else if (action === 'session_leave') {
          session.members = session.members.filter((u) => u !== me);
          if (!session.members.length) sessions = sessions.filter((x) => x !== session);
        } else {
          res.status(400).json({ error: 'unknown action' });
          return;
        }
        await putSessions(sessions);
        res.status(200).json({ ok: true });
        return;
      }

      if (!uid || uid === me) { res.status(400).json({ error: 'who?' }); return; }
      let follows = await getFollows();
      const profiles = await getProfiles();

      if (action === 'follow') {
        // Only people who've put a name up can be found, so only they can be asked.
        if (!profiles[uid] || !profiles[uid].name) { res.status(404).json({ error: 'no one by that id' }); return; }
        if (!follows.some((f) => f.from === me && f.to === uid)) {
          follows.push({ from: me, fromEmail: auth.email || null, to: uid, status: 'pending', at: new Date().toISOString() });
        }
      } else if (action === 'unfollow') {
        follows = follows.filter((f) => !(f.from === me && f.to === uid));
      } else if (action === 'approve') {
        const f = follows.find((x) => x.from === uid && x.to === me);
        if (f) { f.status = 'approved'; f.approvedAt = new Date().toISOString(); }
      } else if (action === 'deny' || action === 'remove') {
        follows = follows.filter((f) => !(f.from === uid && f.to === me));
      } else {
        res.status(400).json({ error: 'unknown action' });
        return;
      }
      await putFollows(follows);
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('people error', e);
    res.status(500).json({ error: 'server error' });
  }
}
