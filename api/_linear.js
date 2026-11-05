import { getLinearMap, putLinearMap } from './_lib.js';

// Linear is where the team files work, and bobby files a lot of it straight at this
// account overnight. Until now it only reached the checklist if something happened to
// mirror it into Notion first, and that mirror is lossy: it carried bobby's issues and
// none of the thirteen filed from here. So this reads Linear directly.
//
// Issues assigned to this account, nothing else. Linear holds thousands of issues and
// almost none of them are this person's to do.

const KEY = (process.env.LINEAR_API_KEY || '').trim();
const API = 'https://api.linear.app/graphql';
// GET /api/sync runs on every tab focus; Linear is no more welcome than Notion is to be
// called that often.
const PULL_EVERY_MS = 5 * 60 * 1000;

export const linearReady = () => KEY.length > 0;

async function linear(query, variables = {}, ms = 5000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(API, {
      method: 'POST',
      signal: ctl.signal,
      headers: { Authorization: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error('linear ' + res.status);
    // GraphQL answers 200 with an errors array, so a bad query looks like success here.
    if (body && body.errors && body.errors.length) {
      throw new Error('linear: ' + (body.errors[0].message || 'query failed'));
    }
    return body && body.data;
  } finally {
    clearTimeout(timer);
  }
}

// Filtering happens here rather than in the query: Linear's filter syntax for state type
// has moved around, and getting it wrong fails silently as an empty list, which looks
// exactly like having nothing to do.
const OPEN = (issue) => {
  const type = issue && issue.state && issue.state.type;
  return type !== 'completed' && type !== 'canceled';
};

export async function openIssues() {
  const data = await linear(`
    query {
      viewer {
        assignedIssues(first: 250) {
          nodes { id identifier title dueDate state { name type } team { id } }
        }
      }
    }
  `);
  const nodes = (data && data.viewer && data.viewer.assignedIssues && data.viewer.assignedIssues.nodes) || [];
  return nodes.filter(OPEN).map((i) => ({
    id: i.id,
    identifier: i.identifier,
    title: (i.title || '').trim(),
    due: i.dueDate ? String(i.dueDate).slice(0, 10) : null,
    team: (i.team && i.team.id) || null,
  })).filter((i) => i.title);
}

// Each team has its own workflow, so "Done" is a different row in each one. Looked up on
// demand and remembered for the life of the function instance.
const doneStates = new Map();
async function doneStateFor(teamId) {
  if (doneStates.has(teamId)) return doneStates.get(teamId);
  const data = await linear(
    `query($teamId: String!) { team(id: $teamId) { states { nodes { id name type position } } } }`,
    { teamId },
  );
  const nodes = (data && data.team && data.team.states && data.team.states.nodes) || [];
  const done = nodes.filter((s) => s.type === 'completed')
    .sort((a, b) => (a.name === 'Done' ? -1 : b.name === 'Done' ? 1 : a.position - b.position))[0];
  const id = (done && done.id) || null;
  doneStates.set(teamId, id);
  return id;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

// The identifier rides along in the text because it is what commit messages and PR
// titles use, so the task reads the same as the branch it turns into.
const taskText = (issue) => issue.identifier + ' ' + issue.title;

function checklistTexts(state) {
  const seen = new Set();
  const add = (t) => { const k = String(t || '').trim().toLowerCase(); if (k) seen.add(k); };
  for (const items of Object.values((state && state.days) || {})) for (const t of items || []) add(t && t.text);
  for (const t of (state && state.backlog) || []) add(t && t.text);
  return seen;
}

// Linear -> checklist. Returns tasks to queue rather than writing them, and remembers
// every issue it has handed over so deleting the task here means deleted.
export async function pullFromLinear(uid, state, { force = false } = {}) {
  if (!linearReady()) return { configured: false, items: [] };

  const map = await getLinearMap(uid);
  const now = Date.now();
  if (!force && map.pulledAt && now - map.pulledAt < PULL_EVERY_MS) {
    return { configured: true, skipped: true, items: [] };
  }

  const pulled = map.pulled || (map.pulled = {});
  const result = { configured: true, queued: 0, failed: 0, errors: [], items: [] };

  try {
    const known = checklistTexts(state);
    for (const issue of await openIssues()) {
      if (pulled[issue.id]) continue;
      const text = taskText(issue);
      pulled[issue.id] = { identifier: issue.identifier, title: issue.title, team: issue.team, at: now };
      if (known.has(text.toLowerCase())) continue;
      result.items.push({ text, date: issue.due || todayStr(), category: 'work' });
      result.queued++;
    }
  } catch (e) {
    result.failed++;
    result.errors.push(String((e && e.message) || e));
  }

  map.pulledAt = now;
  await putLinearMap(uid, map);
  return result;
}

// Ticking a task here closes the issue it came from. Only issues this app handed over
// are ever touched, and only on the save where the tick actually changed.
export async function pushDoneToLinear(uid, state) {
  if (!linearReady()) return { configured: false };

  const map = await getLinearMap(uid);
  const pulled = map.pulled || {};
  const closed = map.closed || (map.closed = {});
  const result = { configured: true, closed: 0, failed: 0, errors: [] };

  const byText = new Map();
  for (const [id, row] of Object.entries(pulled)) byText.set((row.identifier + ' ' + row.title).toLowerCase(), { id, ...row });

  let dirty = false;
  const seen = new Set();
  for (const items of Object.values((state && state.days) || {})) {
    for (const task of items || []) {
      if (!task || !task.done) continue;
      const hit = byText.get(String(task.text || '').trim().toLowerCase());
      if (!hit || closed[hit.id] || seen.has(hit.id)) continue;
      seen.add(hit.id);
      try {
        const stateId = hit.team ? await doneStateFor(hit.team) : null;
        if (!stateId) continue;
        await linear(
          `mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`,
          { id: hit.id, stateId },
        );
        closed[hit.id] = { at: Date.now() };
        result.closed++;
        dirty = true;
      } catch (e) {
        result.failed++;
        if (result.errors.length < 5) result.errors.push(hit.identifier + ': ' + e.message);
      }
    }
  }

  if (dirty) await putLinearMap(uid, map);
  return result;
}
