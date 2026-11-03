// Exercises the Notion -> Backlog -> checklist direction, against a stubbed Notion.
process.env.NOTION_TOKEN = 'secret_test';
process.env.NOTION_BACKLOG_DB = 'backlog-db';
process.env.NOTION_PRIORITIES_DB = 'priorities-db';
process.env.NOTION_OWNER_ID = 'user-fay';
process.env.BLOB_READ_WRITE_TOKEN = 'local-only';

const ROOT = '../api/';
const { pullFromNotion, prioritiesReady } = await import(ROOT + '_notion.js');
const { getNotionMap, putNotionMap } = await import(ROOT + '_lib.js');

const json = (o) => ({ ok: true, status: 200, json: async () => o });
const title = (prop, text) => ({ [prop]: { title: [{ plain_text: text }] } });
const sel = (name) => ({ Status: { select: { name } } });
const stat = (name) => ({ Status: { status: { name } } });
const on = (prop, start) => ({ [prop]: { date: { start } } });

let calls = [];
let priorities = [];
let backlog = [];
let titleHit = null;
let breakOn = null;

globalThis.fetch = async (url, init) => {
  const path = String(url).replace('https://api.notion.com/v1', '');
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path, method: init.method, body });
  if (breakOn && path.includes(breakOn)) return { ok: false, status: 502, json: async () => ({ message: 'bad gateway' }) };
  if (path === '/databases/priorities-db/query') return json({ results: priorities, has_more: false });
  if (path === '/databases/backlog-db/query') {
    // findByTitle asks by title; the open-rows sweep asks by Status.
    if (body && body.filter && body.filter.property === 'Task') {
      return json({ results: titleHit ? [{ id: titleHit }] : [] });
    }
    return json({ results: backlog, has_more: false });
  }
  if (path === '/pages') return json({ id: 'made-' + calls.length });
  return json({ id: 'patched' });
};

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
};
const reset = async (uid) => { calls = []; titleHit = null; breakOn = null; await putNotionMap(uid, { tasks: {} }); };
const made = () => calls.filter((c) => c.path === '/pages');

console.log('configuration');
check('priorities need their own id and an owner', prioritiesReady());

console.log('a priority owned by this person reaches the Backlog');
await reset('u1');
priorities = [{ id: 'p1', properties: { ...title('Name', 'Build new trust page'), ...stat('Not started'), ...on('Date', '2026-11-20') } }];
backlog = [];
let r = await pullFromNotion('u1', { days: {}, backlog: [] }, { force: true });
check('a Backlog row was created', r.created === 1, r);
check('it was created in the Backlog, not Priorities', made()[0].body.parent.database_id === 'backlog-db');
check('under the Task title', made()[0].body.properties.Task.title[0].text.content === 'Build new trust page');
check('nothing was written to Priorities',
  !calls.some((c) => c.method !== 'POST' && String(c.path).includes('priorities-db'))
  && !calls.some((c) => c.path === '/pages' && c.body.parent.database_id === 'priorities-db'));

console.log('the owner filter is what keeps other people out');
const q = calls.find((c) => c.path === '/databases/priorities-db/query');
check('it asks only for this owner', JSON.stringify(q.body.filter).includes('user-fay'), q.body.filter);
check('and only for what is still open', JSON.stringify(q.body.filter).includes('does_not_equal'));

console.log('a priority the Backlog already has is adopted, not duplicated');
await reset('u2');
titleHit = 'existing-row';
priorities = [{ id: 'p1', properties: { ...title('Name', 'Build new trust page'), ...stat('Not started') } }];
backlog = [];
r = await pullFromNotion('u2', { days: {}, backlog: [] }, { force: true });
check('nothing new was made', r.created === 0 && made().length === 0, r);

console.log('an open Backlog row becomes a task');
await reset('u3');
priorities = [];
backlog = [{ id: 'b1', properties: { ...title('Task', 'PalmID logo design'), ...sel('Not started'), ...on('Due date', '2099-01-05') } }];
r = await pullFromNotion('u3', { days: {}, backlog: [] }, { force: true });
check('one task queued', r.queued === 1, r);
check('starred, so it keeps syncing back', r.items[0].text === 'PalmID logo design *', r.items[0]);
check('on the day Notion says', r.items[0].date === '2099-01-05', r.items[0]);
check('and it is work', r.items[0].category === 'work');

console.log('a date already gone by lands on today instead of in the past');
await reset('u4');
backlog = [{ id: 'b1', properties: { ...title('Task', 'Branding swag'), ...sel('Not started'), ...on('Due date', '2020-01-01') } }];
r = await pullFromNotion('u4', { days: {}, backlog: [] }, { force: true });
check('pulled forward to today', r.items[0].date === new Date().toISOString().slice(0, 10), r.items[0]);

console.log('what the checklist already says is left alone');
await reset('u5');
backlog = [
  { id: 'b1', properties: { ...title('Task', 'PalmID logo design'), ...sel('Not started') } },
  { id: 'b2', properties: { ...title('Task', 'iPhone duo design'), ...sel('Not started') } },
];
const state = {
  days: { '2026-11-03': [{ id: 'x', text: 'palmid logo design', done: false, category: 'work' }] },
  backlog: [{ id: 'y', text: 'iPhone duo design *', done: false, category: 'work' }],
};
r = await pullFromNotion('u5', state, { force: true });
check('neither arrives twice', r.queued === 0, r.items);

console.log('a row pulled once never comes back');
await reset('u6');
backlog = [{ id: 'b1', properties: { ...title('Task', 'Animate new onboarding'), ...sel('Not started') } }];
r = await pullFromNotion('u6', { days: {}, backlog: [] }, { force: true });
check('it arrives the first time', r.queued === 1);
// The task is deleted from the checklist, and the empty state is what the next pull sees.
r = await pullFromNotion('u6', { days: {}, backlog: [] }, { force: true });
check('deleting it does not drag it back', r.queued === 0, r.items);

console.log('it does not read Notion on every single load');
await reset('u7');
backlog = [{ id: 'b1', properties: { ...title('Task', 'Figure out deck'), ...sel('Not started') } }];
await pullFromNotion('u7', { days: {}, backlog: [] }, { force: true });
calls = [];
r = await pullFromNotion('u7', { days: {}, backlog: [] });
check('the second load skips it', r.skipped === true, r);
check('and Notion was not called at all', calls.length === 0);

console.log('Notion falling over');
await reset('u8');
priorities = [];
backlog = [];
breakOn = 'backlog-db';
r = await pullFromNotion('u8', { days: {}, backlog: [] }, { force: true });
check('the failure is reported, not thrown', r.failed === 1, r);
check('and nothing is queued', r.items.length === 0);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
