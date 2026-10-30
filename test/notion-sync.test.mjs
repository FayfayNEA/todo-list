// Exercises api/_notion.js against a stubbed Notion, over the in-memory blob fake.
process.env.NOTION_TOKEN = 'secret_test';
process.env.NOTION_BACKLOG_DB = 'db-123';
process.env.BLOB_READ_WRITE_TOKEN = 'local-only';

const ROOT = '../api/';
const { syncMarked, markedTasks, weekLabel, bareText, isMarked, propertiesFor } =
  await import(ROOT + '_notion.js');

let calls = [];
let titleHit = null;
globalThis.fetch = async (url, init) => {
  const path = String(url).replace('https://api.notion.com/v1', '');
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path, method: init.method, body });
  if (path.endsWith('/query')) {
    return json({ results: titleHit ? [{ id: titleHit }] : [] });
  }
  if (path === '/pages') return json({ id: 'new-page-' + calls.length });
  return json({ id: path.slice('/pages/'.length) });
};
const json = (o) => ({ ok: true, status: 200, json: async () => o });

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
};
const post = () => calls.filter((c) => c.path === '/pages');
const patch = () => calls.filter((c) => c.method === 'PATCH');

// ---------- pure bits ----------
console.log('marker and week');
check('a trailing star marks a task', isMarked('Website handoff *'));
check('no star, no sync', !isMarked('look into bootleg photoshop'));
check('a star mid-text is not a marker', !isMarked('5 * 5 sketches'));
check('the star is stripped', bareText('Website handoff *') === 'Website handoff');
check('Monday of the 26th', weekLabel('2026-10-26') === '10/26 week');
check('Friday still says 10/26', weekLabel('2026-10-30') === '10/26 week');
check('Sunday belongs to the week before', weekLabel('2026-11-01') === '10/26 week');
check('no date, no week', weekLabel(null) === null);

console.log('what crosses over');
const state = {
  days: {
    '2026-10-27': [
      { id: 'a', text: 'Check in on three error states *', done: false, category: 'work' },
      { id: 'b', text: 'check in with website', done: false, category: 'work' },
      { id: 'c', text: 'order mascaura *', done: false, category: 'personal' },
    ],
    '2026-10-30': [{ id: 'd', text: 'Design Dinner update *', done: true, category: 'work' }],
  },
  backlog: [{ id: 'e', text: 'Branding swag *', done: false, category: 'work' }],
};
const picked = markedTasks(state).map((t) => t.text).sort();
check('only starred work tasks', JSON.stringify(picked) ===
  JSON.stringify(['Branding swag', 'Check in on three error states', 'Design Dinner update']), picked);
check('a personal star never leaves', !markedTasks(state).some((t) => t.text === 'order mascaura'));

console.log('status is only written when it is known');
check('ticked means Done', propertiesFor({ text: 'x', done: true }).Status.select.name === 'Done');
check('a new row starts Not started',
  propertiesFor({ text: 'x', done: false, creating: true }).Status.select.name === 'Not started');
check('an untouched row keeps its hand-set status',
  propertiesFor({ text: 'x', done: false, creating: false }).Status === undefined);
check('unticking a Done row walks it back',
  propertiesFor({ text: 'x', done: false, wasDone: true }).Status.select.name === 'In progress');

// ---------- the sync itself ----------
console.log('first run');
calls = [];
let r = await syncMarked('owner', state);
check('three rows created', r.created === 3, r);
check('nothing failed', r.failed === 0, r.errors);
const made = post().map((c) => c.body.properties);
check('the day becomes the Date',
  made.some((p) => p.Task.title[0].text.content === 'Design Dinner update' && p.Date.date.start === '2026-10-30'));
check('the week is filled in',
  made.some((p) => p.Task.title[0].text.content === 'Design Dinner update' && p.Week.select.name === '10/26 week'));
check('a backlog task gets no date',
  made.some((p) => p.Task.title[0].text.content === 'Branding swag' && p.Date === undefined));

console.log('saving again with nothing changed');
calls = [];
r = await syncMarked('owner', state);
check('no writes at all', calls.length === 0, calls.map((c) => c.path));
check('all three counted unchanged', r.unchanged === 3, r);

console.log('ticking one off');
calls = [];
state.days['2026-10-27'][0].done = true;
r = await syncMarked('owner', state);
check('one row updated, none created', r.updated === 1 && r.created === 0, r);
check('it was a PATCH to the row it already had', patch().length === 1);
check('and it says Done', patch()[0].body.properties.Status.select.name === 'Done');

console.log('moving a task to another day');
calls = [];
state.days['2026-10-28'] = state.days['2026-10-27'].splice(0, 1);
r = await syncMarked('owner', state);
check('the Date follows the move', patch()[0].body.properties.Date.date.start === '2026-10-28', r);
check('nothing new was made', r.created === 0, r);

console.log('unstarring a task');
calls = [];
state.days['2026-10-28'][0].text = 'Check in on three error states';
r = await syncMarked('owner', state);
check('it simply stops syncing', calls.length === 0 && r.updated === 0, r);

console.log('a task typed fresh that Notion already has a row for');
calls = [];
titleHit = 'existing-row-9';
state.backlog.push({ id: 'f', text: 'Palm dot redesign *', done: false, category: 'work' });
r = await syncMarked('owner', state);
check('the existing row is adopted, not duplicated', r.created === 0 && r.updated === 1, r);
check('and it was patched by that id', patch()[0].path === '/pages/existing-row-9', patch()[0]);

console.log('Notion falling over');
calls = [];
titleHit = null;
globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ message: 'bad gateway' }) });
state.backlog.push({ id: 'g', text: 'Animate new onboarding *', done: false, category: 'work' });
r = await syncMarked('owner', state);
check('the failure is reported, not thrown', r.failed === 1, r);
check('and it names the task', /Animate new onboarding/.test(r.errors[0]), r.errors);

console.log('\n' + (failures ? failures + ' FAILED' : 'all passed'));
process.exit(failures ? 1 : 0);
