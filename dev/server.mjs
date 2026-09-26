// Local practice copy of the app: the real page and the real api/ handlers, over an
// in-memory store, seeded with you and three pretend people. Nothing touches the live
// site or its data. Run with `npm run dev:local`, then open http://localhost:4325/dev.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dreamyPng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4325);
// Each person in the side-by-side view gets their own port: a different origin means a
// separate sign-in, so four of them can be open at once in one browser.
const SEAT_PORTS = { you: PORT + 1, mika: PORT + 2, jo: PORT + 3, ren: PORT + 4 };
Object.assign(process.env, {
  AUTH_SECRET: crypto.randomBytes(24).toString('hex'),
  OWNER_EMAIL: 'you@test.localhost',
  BLOB_READ_WRITE_TOKEN: 'local-only',
});
delete process.env.APP_SECRET;
delete process.env.RESEND_API_KEY;

const routes = {};
for (const f of fs.readdirSync(path.join(ROOT, 'api'))) {
  if (f.startsWith('_') || !f.endsWith('.js')) continue;
  routes[f.slice(0, -3)] = (await import(path.join(ROOT, 'api', f))).default;
}

// Call a handler the way Vercel would, without HTTP.
async function call(route, method, { token, body, query = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method, query, body, headers: token ? { authorization: 'Bearer ' + token } : {} };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, data: o }); },
      end() { resolve({ status: this.statusCode, data: null }); },
    };
    routes[route](req, res);
  });
}

// ---------- seed ----------
const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const addDays = (n) => { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const id = () => crypto.randomUUID();
const task = (text, category = 'work', done = false) => ({ id: id(), text, category, done });
const photoId = (src) => crypto.createHash('sha256').update(src).digest('hex').slice(0, 32);

const PEOPLE = [
  {
    key: 'you', email: 'you@test.localhost', name: 'Fay',
    blurb: 'you: the owner account, with your eight polaroids',
    profile: { showDay: true, showStickers: true },
    state: {
      days: { [today]: [
        { ...task('review venice feedback'), id: 'fay-venice' },
        { ...task('ship reverify flow'), id: 'fay-reverify', subtasks: [
          { id: 'fs1', text: 'fix the retry copy', done: true },
          { id: 'fs2', text: 'test on a slow network', done: false },
        ] },
        task('call the vet', 'personal'),
      ] },
      backlog: [task('overhaul toasts'), task('redesign auth email')],
      manifesto: [{ id: id(), text: 'make things that feel alive', bullets: [{ id: id(), text: 'the difference between a tool and a toy' }] }],
      checkins: {},
    },
  },
  {
    key: 'mika', email: 'mika@test.localhost', name: 'Mika',
    blurb: 'purple, glass card, a dreamy background, stretched today',
    profile: { showDay: true, showStickers: true },
    theme: { hue: 268, sat: 1, title: "mika's garden", card: 'glass' },
    bg: dreamyPng(640, 400, [233, 213, 247], [247, 222, 214], [[190, 150, 230], [250, 190, 210], [170, 140, 220], [240, 210, 250]], 7),
    stickers: [
      { name: 'crescent-moon', dx: -640, top: 90, size: 90, rot: '-8deg' },
      { name: 'star', dx: 520, top: 120, size: 60, rot: '12deg' },
      { name: 'water-maiden', dx: -600, top: 470, size: 150, rot: '0deg' },
      { name: 'sun-face', dx: 560, top: 560, size: 80, rot: '6deg' },
    ],
    state: {
      days: { [today]: [task('moodboard for the launch', 'work', true), task('type pairing for the deck'), task('3 hero options'), task('dentist', 'personal')] },
      backlog: [task('icon audit'), task('illustration style guide'), task('secret side quest', 'personal')],
      checkins: { [today]: { stress: 2 } },
    },
  },
  {
    key: 'jo', email: 'jo@test.localhost', name: 'Jo',
    blurb: 'green, plain card, a polaroid, fried today',
    profile: { showDay: true, showStickers: true },
    theme: { hue: 150, sat: 0.8, title: 'jo gets it done', card: 'plain' },
    bg: dreamyPng(640, 400, [214, 238, 222], [236, 244, 214], [[160, 210, 180], [200, 230, 170], [150, 200, 190]], 3),
    stickers: [
      { name: 'fawn', dx: -620, top: 140, size: 110, rot: '-4deg' },
      { name: 'mouse', dx: 540, top: 90, size: 70, rot: '8deg' },
      { name: 'swans', dx: 520, top: 520, size: 120, rot: '-3deg' },
    ],
    polaroid: dreamyPng(200, 256, [250, 226, 196], [220, 180, 160], [[240, 200, 140], [200, 150, 150]], 11),
    state: {
      days: { [today]: [task('fix onboarding copy'), task('QA the release'), task('write the changelog'), task('investor update'), task('reply to 40 emails')] },
      backlog: [task('refresh icon set'), task('audit empty states')],
      checkins: { [today]: { stress: 3 } },
    },
  },
  {
    key: 'ren', email: 'ren@test.localhost', name: 'Ren',
    blurb: 'amber, a picture on the card, calm, shares the day but not stickers',
    profile: { showDay: true, showStickers: false },
    theme: { hue: 36, sat: 1, title: "ren's desk", card: 'photo' },
    card: dreamyPng(640, 400, [250, 236, 210], [244, 214, 180], [[240, 200, 150], [250, 225, 190], [230, 190, 140]], 5),
    state: {
      days: { [today]: [task('plan the offsite', 'work', true), task('budget review')] },
      backlog: [task('hiring rubric')],
      checkins: { [today]: { stress: 0 } },
    },
  },
];

const tokens = {};
const uids = {};
for (const p of PEOPLE) {
  const password = crypto.randomBytes(12).toString('hex');   // never needed: /dev signs you in
  const out = await call('auth', 'POST', { body: { action: 'signup', email: p.email, password } });
  tokens[p.key] = out.data.token;
  const me = await call('people', 'PUT', { token: tokens[p.key], body: { name: p.name, ...p.profile } });
  if (me.status !== 200) throw new Error('seed failed for ' + p.key);
}
for (const p of PEOPLE) {
  const t = tokens[p.key];
  await call('sync', 'PUT', { token: t, body: { ideas: [], quotes: [], manifesto: [], checkins: {}, backlog: [], days: {}, ...p.state } });
  const theme = { ...(p.theme || {}) };
  for (const [field, src] of [['bg', p.bg], ['cardBg', p.card]]) {
    if (!src) continue;
    await call('people', 'PUT', { token: t, body: { photo: { id: photoId(src), src } } });
    theme[field] = photoId(src);
  }
  if (Object.keys(theme).length) await call('people', 'PUT', { token: t, body: { theme } });
  if (p.stickers) await call('people', 'PUT', { token: t, body: { stickers: p.stickers.map((s) => ({ uid: id(), ...s })) } });
  if (p.polaroid) {
    await call('people', 'PUT', { token: t, body: { photo: { id: photoId(p.polaroid), src: p.polaroid } } });
    await call('people', 'PUT', { token: t, body: { pins: [{ photo: photoId(p.polaroid), rot: '-5deg', dx: -660, top: 330 }] } });
  }
  const who = await call('people', 'GET', { token: tokens.you, query: { q: p.name } });
  const hit = who.data.results && who.data.results.find((r) => r.name === p.name);
  if (hit) uids[p.key] = hit.uid;
}
uids.you = 'owner';

// You follow all three and they've said yes; Mika and Jo follow you back. Ren has asked
// and is waiting on you, so there's a request to approve.
for (const k of ['mika', 'jo', 'ren']) {
  await call('people', 'POST', { token: tokens.you, body: { action: 'follow', uid: uids[k] } });
  await call('people', 'POST', { token: tokens[k], body: { action: 'approve', uid: 'owner' } });
  await call('people', 'POST', { token: tokens[k], body: { action: 'follow', uid: 'owner' } });
}
for (const k of ['mika', 'jo']) await call('people', 'POST', { token: tokens.you, body: { action: 'approve', uid: uids[k] } });

await call('people', 'POST', { token: tokens.mika, body: { action: 'ask', uid: 'owner', date: today, text: 'send mika the launch moodboard' } });
// Something already said about your day, so there's a thread to look at from the start.
await call('comments', 'POST', { token: tokens.jo, query: { uid: 'owner' }, body: { date: today, text: 'maybe venice first? they asked twice' } });
await call('comments', 'POST', { token: tokens.mika, query: { uid: 'owner' }, body: { date: today, taskId: 'fay-reverify', text: 'the retry state looked great on my phone' } });
const sess = await call('people', 'POST', { token: tokens.mika, body: { action: 'session_new', title: 'launch week', uids: ['owner', uids.jo] } });
await call('people', 'POST', { token: tokens.mika, body: { action: 'session_note', id: sess.data.id, text: 'hero options by wednesday?' } });
await call('people', 'POST', { token: tokens.jo, body: { action: 'session_note', id: sess.data.id, text: 'copy freeze thursday, then QA' } });

// ---------- things to make happen ----------
// Each one acts as a pretend person, so you can watch it land on your side.
const ACTIONS = {
  'jo-day-note': ['Jo leaves a note on your day', () =>
    call('comments', 'POST', { token: tokens.jo, query: { uid: 'owner' }, body: { date: today, text: 'can we swap standup to 11 tomorrow?' } })],
  'mika-task-note': ['Mika leaves a note on "ship reverify flow"', () =>
    call('comments', 'POST', { token: tokens.mika, query: { uid: 'owner' }, body: { date: today, taskId: 'fay-reverify', text: 'loop me in before it ships, I want to screenshot it' } })],
  'jo-step': ['Jo suggests a step on "ship reverify flow"', () =>
    call('comments', 'POST', { token: tokens.jo, query: { uid: 'owner' }, body: { date: today, taskId: 'fay-reverify', kind: 'step', text: 'write the release note' } })],
  'mika-ask': ['Mika asks to add something to your day', () =>
    call('people', 'POST', { token: tokens.mika, body: { action: 'ask', uid: 'owner', date: today, text: 'review the hero options with me' } })],
  'ren-collab': ['Ren asks to collab on "review venice feedback"', () =>
    call('people', 'POST', { token: tokens.ren, body: { action: 'ask', kind: 'collab', uid: 'owner', date: today, text: 'review venice feedback' } })],
  'jo-fried-to-okay': ['Jo feels better: fried to okay', async () => {
    const st = (await call('sync', 'GET', { token: tokens.jo })).data;
    st.checkins = { ...(st.checkins || {}), [today]: { stress: 1 } };
    return call('sync', 'PUT', { token: tokens.jo, body: st });
  }],
  'mika-finishes': ['Mika ticks off "type pairing for the deck"', async () => {
    const st = (await call('sync', 'GET', { token: tokens.mika })).data;
    (st.days[today] || []).forEach((t) => { if (t.text === 'type pairing for the deck') t.done = true; });
    return call('sync', 'PUT', { token: tokens.mika, body: st });
  }],
};

function allPage() {
  const seats = PEOPLE.map((p) => `
    <section><header><b>${p.name}</b><a href="http://localhost:${SEAT_PORTS[p.key]}/dev/as/${p.key}" target="_blank">open alone</a></header>
    <iframe src="http://localhost:${SEAT_PORTS[p.key]}/dev/as/${p.key}"></iframe></section>`).join('');
  const buttons = Object.entries(ACTIONS).map(([k, [label]]) => `<button onclick="act('${k}')">${label}</button>`).join('');
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>everyone at once</title>
<style>
  body { margin: 0; font: 13px/1.4 -apple-system, system-ui, sans-serif; background: #e4e2dc; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px 12px; background: #f2f5f7; border-bottom: 1px solid #c7dcec; }
  .bar b { margin-right: 6px; } .bar button { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 16px; border: 1px solid #9dc3e0; background: #fff; cursor: pointer; }
  .bar button:hover { background: #d9e6ee; } .bar .said { color: #3b7ea8; margin-left: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 10px; padding: 10px; }
  section { background: #f2f5f7; border: 1px solid #c7dcec; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
  header { display: flex; justify-content: space-between; padding: 6px 10px; font-size: 12px; } header a { color: #75899a; }
  iframe { border: 0; width: 100%; height: 78vh; background: #edece7; }
</style>
<div class="bar"><b>make something happen:</b>${buttons}<span class="said" id="said"></span></div>
<div class="grid">${seats}</div>
<script>
  async function act(k) {
    const r = await fetch('/dev/act?what=' + k, { method: 'POST' }).then(r => r.json());
    document.getElementById('said').textContent = r.ok ? 'done: ' + r.label : 'that did not work';
    // Tell every board to look again now rather than on its next tick.
    document.querySelectorAll('iframe').forEach(f => f.contentWindow.postMessage('look-again', '*'));
  }
</script>`;
}

// ---------- the switcher ----------
function devPage() {
  const rows = PEOPLE.map((p) => `
    <button onclick="be('${p.key}')"><b>be ${p.name}</b><span>${p.blurb}</span></button>`).join('');
  const accounts = Object.fromEntries(PEOPLE.map((p) => [p.key, {
    token: tokens[p.key], account: { email: p.email, isOwner: p.key === 'you' },
  }]));
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>practice accounts</title>
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; background: #edece7; color: #17170f; margin: 0; padding: 32px 16px; }
  main { max-width: 520px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 4px; } p { color: #75899a; margin: 0 0 20px; }
  button { display: block; width: 100%; text-align: left; margin: 0 0 10px; padding: 14px 16px; border-radius: 10px;
    border: 1px solid #c7dcec; background: #f2f5f7; cursor: pointer; font: inherit; }
  button:hover { border-color: #67a5cf; } button span { display: block; color: #75899a; font-size: 12px; }
</style>
<main>
  <h1>practice accounts</h1>
  <p><a href="/dev/all"><b>everyone at once →</b></a> all four side by side, with buttons that act as them.</p>
  <p>a local copy of the app with pretend people. nothing here touches the real site, and it all resets when the server restarts. come back to this page to switch who you are.</p>
  ${rows}
</main>
<script>
  const ACCOUNTS = ${JSON.stringify(accounts)};
  function be(key) {
    const a = ACCOUNTS[key];
    localStorage.setItem('tracker:token:v1', a.token);
    localStorage.setItem('tracker:account:v1', JSON.stringify(a.account));
    localStorage.setItem('sharedMode', '1');
    location.href = '/';
  }
</script>`;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const app = async (req, res) => {
  const u = new URL(req.url, 'http://local');
  if (u.pathname === '/dev') { res.setHeader('content-type', 'text/html'); res.end(devPage()); return; }
  if (u.pathname === '/dev/all') { res.setHeader('content-type', 'text/html'); res.end(allPage()); return; }
  if (u.pathname === '/dev/act' && req.method === 'POST') {
    const a = ACTIONS[u.searchParams.get('what')];
    const out = a ? await a[1]() : null;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: !!out && out.status < 400, label: a ? a[0] : null }));
    return;
  }
  const seat = /^\/dev\/as\/(\w+)$/.exec(u.pathname);
  if (seat && tokens[seat[1]]) {
    const p = PEOPLE.find((x) => x.key === seat[1]);
    res.setHeader('content-type', 'text/html');
    res.end(`<script>
      localStorage.clear();
      localStorage.setItem('tracker:token:v1', ${JSON.stringify(tokens[seat[1]])});
      localStorage.setItem('tracker:account:v1', ${JSON.stringify(JSON.stringify({ email: p.email, isOwner: p.key === 'you' }))});
      localStorage.setItem('sharedMode', '1');
      location.replace('/');
    </script>`);
    return;
  }
  const m = /^\/api\/(\w+)$/.exec(u.pathname);
  if (m) {
    const handler = routes[m[1]];
    if (!handler) { res.statusCode = 404; res.end(); return; }
    req.query = Object.fromEntries(u.searchParams);
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    try { await handler(req, res); } catch (e) { console.error(e); res.statusCode = 500; res.end(); }
    return;
  }
  const file = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}dev${path.sep}`)) { res.statusCode = 404; res.end(); return; }
  fs.readFile(file, (e, data) => {
    if (e) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
};
http.createServer(app).listen(PORT, () => console.log(`practice copy on http://localhost:${PORT}/dev  (everyone at once: /dev/all)`));
for (const port of Object.values(SEAT_PORTS)) http.createServer(app).listen(port);
