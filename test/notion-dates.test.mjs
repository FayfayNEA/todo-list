// Moving a task to another day is the one thing that writes to the team's board.
process.env.NOTION_TOKEN = 'secret_test';
process.env.NOTION_BACKLOG_DB = 'backlog-db';
process.env.NOTION_PRIORITIES_DB = 'priorities-db';
process.env.NOTION_OWNER_ID = 'user-fay';
process.env.BLOB_READ_WRITE_TOKEN = 'local-only';

const ROOT = '../api/';
const { syncMarked } = await import(ROOT + '_notion.js');
const { putNotionMap, getNotionMap } = await import(ROOT + '_lib.js');

const json = (o) => ({ ok: true, status: 200, json: async () => o });
let calls = [];
let priorityHit = 'prio-1';
globalThis.fetch = async (url, init) => {
  const path = String(url).replace('https://api.notion.com/v1', '');
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path, method: init.method, body });
  if (path === '/databases/priorities-db/query') return json({ results: priorityHit ? [{ id: priorityHit }] : [] });
  if (path === '/databases/backlog-db/query') return json({ results: [{ id: 'backlog-row' }] });
  if (path === '/pages') return json({ id: 'made' });
  return json({ id: 'patched' });
};

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
};
const prioPatches = () => calls.filter((c) => c.method === 'PATCH' && c.path === '/pages/prio-1');
const dayState = (date) => ({ days: { [date]: [{ id: 't1', text: 'User surveys rollout *', done: false, category: 'work' }] }, backlog: [] });

console.log('a first sync does not touch Priorities');
await putNotionMap('u1', { tasks: {} });
calls = [];
await syncMarked('u1', dayState('2026-11-06'));
check('the Backlog row is written', calls.some((c) => c.method === 'PATCH' && c.path === '/pages/backlog-row'));
check('Priorities is left alone', prioPatches().length === 0, calls.map((c) => c.path));

console.log('moving the task to another day moves the date there');
calls = [];
await syncMarked('u1', dayState('2026-11-10'));
check('one write to Priorities', prioPatches().length === 1, calls.map((c) => c.path));
check('with the new date', prioPatches()[0].body.properties.Date.date.start === '2026-11-10', prioPatches()[0].body);
check('and the week that date falls in', prioPatches()[0].body.properties.Week.select.name === '11/09 week', prioPatches()[0].body);
check('status is never written there', !('Status' in prioPatches()[0].body.properties), prioPatches()[0].body.properties);

console.log('it only looks at rows this person owns');
const q = calls.find((c) => c.path === '/databases/priorities-db/query');
check('the lookup is filtered by owner', JSON.stringify(q.body.filter).includes('user-fay'), q.body.filter);
check('and by exact title', JSON.stringify(q.body.filter).includes('User surveys rollout'));

console.log('saving again without moving it writes nothing');
calls = [];
await syncMarked('u1', dayState('2026-11-10'));
check('Priorities untouched', prioPatches().length === 0, calls.map((c) => c.path));

console.log('a task with no row of its own on the board');
priorityHit = null;
calls = [];
await syncMarked('u1', dayState('2026-11-17'));
check('nothing is patched there', prioPatches().length === 0);
check('and the Backlog still got its update', calls.some((c) => c.method === 'PATCH' && c.path === '/pages/backlog-row'));

console.log('Priorities falling over does not fail the save');
priorityHit = 'prio-1';
await putNotionMap('u2', { tasks: {} });
await syncMarked('u2', dayState('2026-11-06'));
const good = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('priorities-db')) throw new Error('network down');
  return good(url, init);
};
calls = [];
let threw = null;
try { await syncMarked('u2', dayState('2026-11-20')); } catch (e) { threw = e; }
globalThis.fetch = good;
check('the sync still finished', !threw, threw && threw.message);
const map = await getNotionMap('u2');
check('and the move was still recorded', map.tasks.t1.date === '2026-11-20', map.tasks.t1);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
