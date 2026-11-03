import { getNotionMap, putNotionMap } from './_lib.js';
import crypto from 'node:crypto';

// Mirrors starred work tasks into the Backlog database on the Notion Design To-Do page,
// so the product hub stays current without anyone opening Notion to keep it that way.
//
// One direction only. Notion is never read back into the checklist: two writers on one
// row is a conflict nobody asked for, and the checklist is the side being typed into.
//
// A task crosses over when its text ends in a star. The marker is deliberate — a day
// here is full of small chatter ("check in with website") that would bury the real
// priorities in a hub other people read.

const TOKEN = (process.env.NOTION_TOKEN || '').trim();
const DB = (process.env.NOTION_BACKLOG_DB || '').trim();
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';

export const notionReady = () => TOKEN.length > 0 && DB.length > 0;

const MARKER = /\s*\*+\s*$/;
export const isMarked = (text) => typeof text === 'string' && MARKER.test(text);
export const bareText = (text) => String(text).replace(MARKER, '').trim();

// Monday of the week a date falls in, in the "10/26 week" shape the Week column uses.
// Notion makes a select option it has not seen before, so a new week needs no setup.
export function weekLabel(date) {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd} week`;
}

// Every starred work task, from the days and from the backlog. Personal never leaves
// this app.
export function markedTasks(state) {
  const out = [];
  const take = (t, date) => {
    if (!t || t.category === 'personal' || !isMarked(t.text)) return;
    const text = bareText(t.text);
    if (text) out.push({ id: t.id, text, date, done: !!t.done });
  };
  for (const [date, items] of Object.entries((state && state.days) || {})) {
    for (const t of items || []) take(t, date);
  }
  for (const t of (state && state.backlog) || []) take(t, null);
  return out;
}

const fingerprint = (t) =>
  crypto.createHash('sha256').update([t.text, t.date || '', t.done ? '1' : '0'].join('\u0000'))
    .digest('hex').slice(0, 16);

// Status is only written when this app actually knows something about it: ticking a task
// means Done, and a new row starts Not started. Anything else is left alone, because
// "In progress" and "Blocked" are set by hand in Notion and guessing would undo that.
export function propertiesFor({ text, date, done, wasDone, creating }) {
  const props = { Task: { title: [{ text: { content: text.slice(0, 2000) } }] } };
  if (date) {
    props.Date = { date: { start: date } };
    const week = weekLabel(date);
    if (week) props.Week = { select: { name: week } };
  }
  if (done) props.Status = { select: { name: 'Done' } };
  else if (creating) props.Status = { select: { name: 'Not started' } };
  else if (wasDone) props.Status = { select: { name: 'In progress' } };
  return props;
}

async function notion(path, init = {}, ms = 5000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(API + path, {
      ...init,
      signal: ctl.signal,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Notion-Version': VERSION,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error('notion ' + res.status + ' ' + ((body && body.message) || ''));
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// The database already has rows for most of this work, so a task being synced for the
// first time looks for its row by title before making a second one.
async function findByTitle(text) {
  const r = await notion('/databases/' + DB + '/query', {
    method: 'POST',
    body: JSON.stringify({ filter: { property: 'Task', title: { equals: text } }, page_size: 1 }),
  });
  return (r && r.results && r.results[0] && r.results[0].id) || null;
}

// What the checklist no longer says is left in Notion untouched: unstarring a task, or
// deleting it here, stops it syncing rather than removing somebody else's row.
export async function syncMarked(uid, state, { force = false } = {}) {
  if (!notionReady()) return { configured: false };

  const map = await getNotionMap(uid);
  const seen = map.tasks || (map.tasks = {});
  const result = { configured: true, created: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };
  let dirty = false;

  for (const task of markedTasks(state)) {
    const hash = fingerprint(task);
    const known = seen[task.id];
    if (known && known.hash === hash && !force) { result.unchanged++; continue; }

    try {
      let page = (known && known.page) || (await findByTitle(task.text));
      const properties = propertiesFor({
        text: task.text,
        date: task.date,
        done: task.done,
        wasDone: !!(known && known.done),
        creating: !page,
      });
      if (page) {
        await notion('/pages/' + page, { method: 'PATCH', body: JSON.stringify({ properties }) });
        result.updated++;
      } else {
        const made = await notion('/pages', {
          method: 'POST',
          body: JSON.stringify({ parent: { database_id: DB }, properties }),
        });
        page = made.id;
        result.created++;
      }
      seen[task.id] = { page, hash, text: task.text, date: task.date, done: task.done };
      dirty = true;
    } catch (e) {
      result.failed++;
      if (result.errors.length < 5) result.errors.push(task.text + ': ' + e.message);
      console.error('notion sync', task.text, e.message);
    }
  }

  if (dirty) await putNotionMap(uid, map);
  return result;
}

// ---------- the other direction ----------
// Priorities is the team's board, and this app never writes to it. Rows there that
// belong to one person are copied into the Backlog, and the Backlog is what reaches the
// checklist — so the Design To-Do page stays the single thing other people read, and
// nothing the checklist does can disturb the team's board.
//
// A row that has been pulled once is never pulled again. Without that, deleting a task
// in the checklist would bring it straight back on the next load, which is maddening
// and looks exactly like a bug.

const PRIORITIES_DB = (process.env.NOTION_PRIORITIES_DB || '').trim();
const OWNER_ID = (process.env.NOTION_OWNER_ID || '').trim();
// GET /api/sync runs on every load and every tab focus. Reading Notion that often would
// make the app feel like Notion; once every few minutes is enough to feel immediate.
const PULL_EVERY_MS = 5 * 60 * 1000;

export const prioritiesReady = () => notionReady() && !!PRIORITIES_DB && !!OWNER_ID;

const titleOf = (page, prop) => {
  const cell = page && page.properties && page.properties[prop];
  return ((cell && cell.title) || []).map((r) => r.plain_text || '').join('').trim();
};
// Backlog's Status is a select and Priorities' is a status property. They read the same.
const optionName = (page, prop) => {
  const cell = page && page.properties && page.properties[prop];
  const v = cell && (cell.select || cell.status);
  return (v && v.name) || null;
};
const dateStart = (page, prop) => {
  const cell = page && page.properties && page.properties[prop];
  return cell && cell.date && cell.date.start ? String(cell.date.start).slice(0, 10) : null;
};

async function queryAll(db, filter) {
  const out = [];
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const r = await notion('/databases/' + db + '/query', { method: 'POST', body: JSON.stringify(body) });
    out.push(...((r && r.results) || []));
    cursor = r && r.has_more ? r.next_cursor : null;
  } while (cursor && out.length < 500);
  return out;
}

// Open rows on the team board that are this person's to do. Someone else's work is not
// their daily list, so Owner is the filter and it is never widened.
export async function openPriorities() {
  const rows = await queryAll(PRIORITIES_DB, {
    and: [
      { property: 'Owner', people: { contains: OWNER_ID } },
      { property: 'Status', status: { does_not_equal: 'Done' } },
    ],
  });
  return rows
    .map((p) => ({ id: p.id, text: titleOf(p, 'Name'), date: dateStart(p, 'Date'), status: optionName(p, 'Status') }))
    .filter((r) => r.text);
}

// Open rows in the Backlog — the list the checklist actually fills itself from.
export async function openBacklog() {
  const rows = await queryAll(DB, { property: 'Status', select: { does_not_equal: 'Done' } });
  return rows
    .map((p) => ({ id: p.id, text: titleOf(p, 'Task'), date: dateStart(p, 'Due date') || dateStart(p, 'Date') }))
    .filter((r) => r.text);
}

// A priority becomes a Backlog row of the same name, or adopts the one already sitting
// there, so running this twice does not leave the page full of pairs.
async function ensureBacklogRow(row) {
  const existing = await findByTitle(row.text);
  if (existing) return { page: existing, created: false };
  const properties = propertiesFor({ text: row.text, date: row.date, done: false, creating: true });
  if (row.status === 'In progress') properties.Status = { select: { name: 'In progress' } };
  const made = await notion('/pages', {
    method: 'POST',
    body: JSON.stringify({ parent: { database_id: DB }, properties }),
  });
  return { page: made.id, created: true };
}

const todayStr = () => new Date().toISOString().slice(0, 10);

// Everything the checklist already says, star or no star, so nothing arrives twice.
function checklistTitles(state) {
  const seen = new Set();
  const add = (text) => {
    const key = bareText(text || '').toLowerCase();
    if (key) seen.add(key);
  };
  for (const items of Object.values((state && state.days) || {})) for (const t of items || []) add(t && t.text);
  for (const t of (state && state.backlog) || []) add(t && t.text);
  return seen;
}

// Priorities -> Backlog -> checklist, in that order. Returns the tasks to queue rather
// than writing them, so the caller stays the only thing that touches the day map.
export async function pullFromNotion(uid, state, { force = false } = {}) {
  if (!notionReady()) return { configured: false, items: [] };

  const map = await getNotionMap(uid);
  const now = Date.now();
  if (!force && map.pulledAt && now - map.pulledAt < PULL_EVERY_MS) {
    return { configured: true, skipped: true, items: [] };
  }

  const pulled = map.pulled || (map.pulled = {});
  const result = { configured: true, created: 0, queued: 0, failed: 0, errors: [], items: [] };
  const fail = (what, e) => {
    result.failed++;
    if (result.errors.length < 5) result.errors.push(what + ': ' + e.message);
  };

  if (prioritiesReady()) {
    try {
      for (const row of await openPriorities()) {
        try {
          if ((await ensureBacklogRow(row)).created) result.created++;
        } catch (e) {
          fail(row.text, e);
        }
      }
    } catch (e) {
      fail('priorities', e);
    }
  }

  try {
    const known = checklistTitles(state);
    for (const row of await openBacklog()) {
      if (pulled[row.id]) continue;
      pulled[row.id] = { text: row.text, at: now };
      if (known.has(row.text.toLowerCase())) continue;
      // The star is what keeps it syncing back once it is in the list.
      result.items.push({ text: row.text + ' *', date: row.date && row.date >= todayStr() ? row.date : todayStr(), category: 'work' });
      result.queued++;
    }
  } catch (e) {
    fail('backlog', e);
  }

  map.pulledAt = now;
  await putNotionMap(uid, map);
  return result;
}
