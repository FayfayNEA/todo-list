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
