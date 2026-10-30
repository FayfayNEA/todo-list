// The two endpoints, over the in-memory blob fake, with Notion NOT configured — the
// state the live site is in right now.
process.env.BLOB_READ_WRITE_TOKEN = 'local-only';
process.env.APP_SECRET = 'legacy-passphrase-for-the-owner';
delete process.env.NOTION_TOKEN;
delete process.env.NOTION_BACKLOG_DB;

const ROOT = '../api/';
const sync = (await import(ROOT + 'sync.js')).default;
const notionSync = (await import(ROOT + 'notion-sync.js')).default;

const call = (handler, method, body) => new Promise((resolve) => {
  const req = { method, query: {}, body, headers: { authorization: 'Bearer ' + process.env.APP_SECRET } };
  const res = {
    statusCode: 200,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(o) { resolve({ status: this.statusCode, data: o }); },
    end() { resolve({ status: this.statusCode, data: null }); },
  };
  handler(req, res);
});

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (extra ? '  ' + JSON.stringify(extra) : '')); }
};

const days = {
  '2026-10-27': [
    { id: 'a', text: 'Check in on three error states *', done: false, category: 'work' },
    { id: 'b', text: 'check in with website', done: false, category: 'work' },
    { id: 'c', text: 'order mascaura', done: false, category: 'personal' },
  ],
};

console.log('saving with no Notion token set');
let r = await call(sync, 'PUT', { days, backlog: [], ideas: [], quotes: [], manifesto: [], checkins: {} });
check('the save still succeeds', r.status === 200 && r.data.ok === true, r);
check('and says nothing about Notion', r.data.notion === undefined, r.data);

console.log('reading it back');
r = await call(sync, 'GET');
check('the day is there', r.data.days['2026-10-27'].length === 3, r.status);
check('the star stays in the checklist text',
  r.data.days['2026-10-27'][0].text === 'Check in on three error states *');

console.log('GET /api/notion-sync');
r = await call(notionSync, 'GET');
check('it answers before a token exists', r.status === 200 && r.data.configured === false, r);
check('one starred task listed', r.data.tasks.length === 1, r.data.tasks);
check('with the star stripped and the week worked out',
  r.data.tasks[0].text === 'Check in on three error states' && r.data.tasks[0].week === '10/26 week',
  r.data.tasks[0]);
check('and Notion does not know it yet', r.data.tasks[0].inNotion === false);

console.log('POST /api/notion-sync with nothing configured');
r = await call(notionSync, 'POST');
check('refuses clearly rather than silently doing nothing', r.status === 503, r);

console.log('\n' + (failures ? failures + ' FAILED' : 'all passed'));
process.exit(failures ? 1 : 0);
