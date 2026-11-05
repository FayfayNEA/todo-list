// Exercises api/_linear.js against a stubbed Linear GraphQL endpoint.
process.env.LINEAR_API_KEY = 'lin_api_test';
process.env.BLOB_READ_WRITE_TOKEN = 'local-only';

const ROOT = '../api/';
const { pullFromLinear, pushDoneToLinear, linearReady } = await import(ROOT + '_linear.js');
const { putLinearMap, getLinearMap } = await import(ROOT + '_lib.js');

const issue = (id, identifier, title, type, due, team) =>
  ({ id, identifier, title, dueDate: due || null, state: { name: type, type }, team: { id: team || 'team-1' } });

let calls = [];
let issues = [];
let graphqlError = null;
const json = (o) => ({ ok: true, status: 200, json: async () => o });

globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url: String(url), query: body.query, variables: body.variables, auth: init.headers.Authorization });
  if (graphqlError) return json({ errors: [{ message: graphqlError }] });
  if (body.query.includes('assignedIssues')) return json({ data: { viewer: { assignedIssues: { nodes: issues } } } });
  if (body.query.includes('states')) {
    return json({ data: { team: { states: { nodes: [
      { id: 'st-backlog', name: 'Backlog', type: 'backlog', position: 0 },
      { id: 'st-done', name: 'Done', type: 'completed', position: 3 },
      { id: 'st-dup', name: 'Duplicate', type: 'completed', position: 4 },
    ] } } } });
  }
  return json({ data: { issueUpdate: { success: true } } });
};

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
};
const today = new Date().toISOString().slice(0, 10);
const mutations = () => calls.filter((c) => c.query.includes('issueUpdate'));
const reset = async (uid) => { calls = []; graphqlError = null; await putLinearMap(uid, { pulled: {}, closed: {} }); };

console.log('configuration');
check('a key is all it needs', linearReady());

console.log('only what is still open comes across');
await reset('u1');
issues = [
  issue('i1', 'VER-961', 'Wellfound: update banner to Very', 'backlog', null),
  issue('i2', 'VER-944', 'Font weight pass on the web check', 'completed', null),
  issue('i3', 'VER-957', 'QR screen with MEXC', 'canceled', null),
  issue('i4', 'VER-960', 'Write-up: why we designed the rebrand', 'started', '2099-02-01'),
];
let r = await pullFromLinear('u1', { days: {}, backlog: [] }, { force: true });
check('two of the four', r.queued === 2, r.items);
check('the done one stays in Linear', !r.items.some((i) => i.text.includes('VER-944')));
check('so does the cancelled one', !r.items.some((i) => i.text.includes('VER-957')));
check('the identifier rides along', r.items[0].text === 'VER-961 Wellfound: update banner to Very', r.items[0]);
check('the key is sent as the Authorization header', calls[0].auth === 'lin_api_test');

console.log('the day it lands on');
const byId = Object.fromEntries(r.items.map((i) => [i.text.slice(0, 7), i.date]));
check('its due date when it has one', byId['VER-960'] === '2099-02-01', byId);
check('today when it has none', byId['VER-961'] === today, byId);

console.log('what the checklist already says is left alone');
await reset('u2');
issues = [issue('i1', 'VER-961', 'Wellfound: update banner to Very', 'backlog', null)];
r = await pullFromLinear('u2', { days: { '2026-11-05': [{ id: 'x', text: 'VER-961 Wellfound: update banner to Very', done: false }] }, backlog: [] }, { force: true });
check('nothing queued twice', r.queued === 0, r.items);

console.log('an issue handed over once never comes back');
await reset('u3');
issues = [issue('i1', 'VER-961', 'Wellfound: update banner to Very', 'backlog', null)];
r = await pullFromLinear('u3', { days: {}, backlog: [] }, { force: true });
check('it arrives', r.queued === 1);
r = await pullFromLinear('u3', { days: {}, backlog: [] }, { force: true });
check('deleting it does not drag it back', r.queued === 0, r.items);

console.log('it does not read Linear on every load');
await reset('u4');
issues = [issue('i1', 'VER-1', 'Something', 'backlog', null)];
await pullFromLinear('u4', { days: {}, backlog: [] }, { force: true });
calls = [];
r = await pullFromLinear('u4', { days: {}, backlog: [] });
check('the second load skips it', r.skipped === true, r);
check('and Linear was not called', calls.length === 0);

console.log('a GraphQL error is a failure, not an empty list');
await reset('u5');
issues = [issue('i1', 'VER-1', 'Something', 'backlog', null)];
graphqlError = 'Argument Validation Error';
r = await pullFromLinear('u5', { days: {}, backlog: [] }, { force: true });
check('reported, not silently nothing to do', r.failed === 1 && r.queued === 0, r);

console.log('ticking a task closes its issue');
await reset('u6');
issues = [issue('i1', 'VER-961', 'Wellfound: update banner to Very', 'backlog', null)];
await pullFromLinear('u6', { days: {}, backlog: [] }, { force: true });
calls = [];
let done = { days: { '2026-11-05': [{ id: 't', text: 'VER-961 Wellfound: update banner to Very', done: true }] }, backlog: [] };
let p = await pushDoneToLinear('u6', done);
check('one issue closed', p.closed === 1, p);
check('by the right mutation', mutations().length === 1 && mutations()[0].variables.id === 'i1', mutations());
check('to the Done state, not Duplicate', mutations()[0].variables.stateId === 'st-done', mutations()[0].variables);

console.log('saving again does not close it twice');
calls = [];
p = await pushDoneToLinear('u6', done);
check('no second mutation', mutations().length === 0 && p.closed === 0, p);

console.log('a task it never handed over is not touched');
await reset('u7');
calls = [];
p = await pushDoneToLinear('u7', { days: { '2026-11-05': [{ id: 't', text: 'laundry', done: true }] }, backlog: [] });
check('nothing closed', p.closed === 0 && mutations().length === 0);

console.log('an unticked task is left open');
await reset('u8');
issues = [issue('i1', 'VER-961', 'Wellfound: update banner to Very', 'backlog', null)];
await pullFromLinear('u8', { days: {}, backlog: [] }, { force: true });
calls = [];
p = await pushDoneToLinear('u8', { days: { '2026-11-05': [{ id: 't', text: 'VER-961 Wellfound: update banner to Very', done: false }] }, backlog: [] });
check('no mutation', mutations().length === 0 && p.closed === 0);

console.log('Linear falling over');
await reset('u9');
issues = [issue('i1', 'VER-961', 'Wellfound: update banner to Very', 'backlog', null)];
await pullFromLinear('u9', { days: {}, backlog: [] }, { force: true });
graphqlError = 'server exploded';
let threw = null;
try { p = await pushDoneToLinear('u9', done); } catch (e) { threw = e; }
check('reported, not thrown', !threw && p.failed === 1, threw ? threw.message : p);
const m = await getLinearMap('u9');
check('and it is not recorded as closed', !Object.keys(m.closed || {}).length, m.closed);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
