// Builds the day.
//
// The planner's job is to answer "what am I doing, and when" so that nobody has to hold
// it in their head. It takes what is fixed (meetings, working hours, the current time),
// what is wanted (tasks, deadlines, goals), and what is known about the person (when they
// think well, what they keep failing to finish at 4pm) and returns a timeline plus the
// decisions it took to get there.
//
// Two rules shape almost everything below:
//
//   1. Capacity is finite and it is the planner's problem, not the reader's. A day with
//      more work than hours does not produce a longer list; it produces a shorter one and
//      a note about what was moved.
//   2. Deep work is claimed before anything else is placed. Left to a greedy pass it
//      loses every time to a pile of small urgent things, which is exactly the failure
//      the person is asking to be protected from.

import {
  normalizeTask, normalizeEvent, normalizeProfile, normalizeGoal,
  remainingMin, subtractIntervals, intervalLength, totalMinutes, daysBetween, clamp,
} from './model.js';
import { completionOdds } from './learning.js';
import { applySignals } from './signals.js';

// ---------- scoring ----------
// One number per task, so ordering and dropping use the same judgement. The weights are
// deliberately legible rather than tuned: this is a stated policy about what matters,
// and it should be arguable.
const W = {
  priority: 30,     // what the person said matters
  urgency: 34,      // how close the deadline is
  goal: 14,         // whether it serves something they are trying to do
  blocking: 10,     // whether other work is waiting on it
  staleness: 6,     // how long it has been carried
  fit: 6,           // whether this is a good hour for this kind of work
};

export function urgencyOf(task, date) {
  if (!task.deadline) return 0.25;
  const days = daysBetween(date, task.deadline);
  if (days < 0) return 1.15;          // already late: above everything else
  if (days === 0) return 1;
  if (days === 1) return 0.8;
  if (days <= 3) return 0.6;
  if (days <= 7) return 0.4;
  return 0.25;
}

export function scoreTask(task, ctx) {
  const { date, goals, history, blockingCount } = ctx;
  const priority = (6 - task.priority) / 5;                   // 1 -> 1.0, 5 -> 0.2
  const urgency = urgencyOf(task, date);
  const goalWeight = goalAlignment(task, goals);
  const blocking = clamp((blockingCount || 0) / 3, 0, 1);
  const staleness = clamp((task.carriedDays || 0) / 5, 0, 1);
  const fit = history ? completionOdds(history, task.kind, ctx.hourBucket) : 0.5;

  return (
    W.priority * priority +
    W.urgency * urgency +
    W.goal * goalWeight +
    W.blocking * blocking +
    W.staleness * staleness +
    W.fit * fit
  );
}

function goalAlignment(task, goals) {
  if (!goals || !goals.length) return 0;
  let best = 0;
  for (const g of goals) {
    const named = task.goalIds.includes(g.id);
    const byKind = g.kinds.includes(task.kind);
    if (named || byKind) best = Math.max(best, (g.weight || 1) / 3);
  }
  return clamp(best, 0, 1);
}

// ---------- dependencies ----------
// A task whose blockers are unfinished cannot be worked on, whatever it scores. Cycles
// are treated as "nothing is blocked" rather than as an error: a broken dependency should
// not be able to empty somebody's day.
export function readyTasks(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Can `from` be reached from `start` by following blockers? If so the edge start->from
  // closes a loop, and honouring it would mean neither task is ever workable. A person
  // who has mis-linked two tasks should get a slightly odd order, not an empty day, so
  // cyclic edges are dropped rather than obeyed.
  const reaches = (start, target) => {
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop();
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const t = byId.get(id);
      if (t) stack.push(...t.blockedBy);
    }
    return false;
  };

  const ready = [];
  const blocked = [];
  for (const t of tasks) {
    if (t.done) continue;
    const unmet = t.blockedBy.filter((b) => {
      const dep = byId.get(b);
      if (!dep || dep.done) return false;          // unknown or finished: not a blocker
      if (reaches(b, t.id)) return false;          // cyclic: refuse to block on it
      return true;
    });
    if (unmet.length) blocked.push({ task: t, waitingOn: unmet });
    else ready.push(t);
  }
  return { ready, blocked };
}

function blockingCounts(tasks) {
  const counts = new Map();
  for (const t of tasks) {
    for (const b of t.blockedBy) counts.set(b, (counts.get(b) || 0) + 1);
  }
  return counts;
}

// ---------- the pass ----------
export function planDay(input) {
  const date = input.date;
  const profile = normalizeProfile(input.profile);
  const goals = (input.goals || []).map(normalizeGoal);
  const autonomySignals = applySignals(input.signals, { profile });
  const now = Number.isFinite(input.nowMin) ? input.nowMin : null;

  const events = (input.events || []).map(normalizeEvent).filter(Boolean)
    .sort((a, b) => a.start - b.start);
  const tasks = (input.tasks || []).map((t) => normalizeTask(t, { date }));

  // The day starts at the later of "when work starts" and "now": a plan that schedules
  // the morning back to somebody at 3pm is a plan they have to mentally discard.
  const dayStart = Math.max(profile.startsAt, now == null ? profile.startsAt : now);
  const dayEnd = profile.endsAt;
  const decisions = [];

  if (dayStart >= dayEnd) {
    return emptyPlan(date, profile, { reason: 'the working day is over', events, tasks });
  }

  // 1. Cut out what cannot move.
  const immovable = events.filter((e) => !e.movable).map((e) => ({ ...e }));
  if (profile.lunch) immovable.push({ ...profile.lunch, id: 'lunch', title: 'lunch', kind: 'break' });
  const buffered = immovable.map((e) => ({
    ...e,
    // Buffers are taken out of schedulable time but are not shown as work.
    end: e.kind === 'break' ? e.end : Math.min(dayEnd, e.end + profile.bufferMin),
  }));

  let free = subtractIntervals([{ start: dayStart, end: dayEnd }], buffered);

  // 2. Hold back a reserve. A day booked to the minute is a day that breaks on the first
  // five-minute surprise, and the person pays for that in scramble.
  const rawCapacity = totalMinutes(free);
  const reserve = Math.round(rawCapacity * profile.reserveRatio * (autonomySignals.reserveMultiplier || 1));
  const capacity = Math.max(0, rawCapacity - reserve);

  // 3. Work out what is even eligible today.
  const { ready, blocked } = readyTasks(tasks.filter((t) => !t.done));
  const blockingCount = blockingCounts(tasks);

  const scored = ready.map((task) => ({
    task,
    score: scoreTask(task, {
      date, goals, history: input.history,
      blockingCount: blockingCount.get(task.id) || 0,
      hourBucket: null,
    }),
  })).sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id));

  // 4. Decide what fits. This is the part that stops a day being a wall of text: work is
  //    admitted in score order until the budget is gone, and the rest is deferred with a
  //    reason rather than displayed as guilt.
  const admitted = [];
  const deferred = [];
  let budget = capacity;
  for (const entry of scored) {
    const need = remainingMin(entry.task);
    const pinned = entry.task.pinnedAt != null;
    if (need <= budget || pinned) {
      admitted.push(entry);
      budget -= need;
    } else {
      deferred.push({
        task: entry.task,
        score: entry.score,
        reason: 'no room today',
        suggestedDate: nextWorkday(date, profile),
      });
    }
  }

  for (const d of deferred) {
    decisions.push({
      type: 'defer', category: 'deferral', date,
      taskId: d.task.id, task: d.task,
      to: d.suggestedDate,
      because: 'the day was short by more time than this task needs',
    });
  }

  // 5. Place the work.
  const blocks = [];
  for (const e of events) blocks.push({ type: 'event', start: e.start, end: e.end, eventId: e.id, title: e.title });
  if (profile.lunch) blocks.push({ type: 'break', start: profile.lunch.start, end: profile.lunch.end, title: 'lunch' });

  // 5a. Pinned work first: the person put it there on purpose.
  const pinnedEntries = admitted.filter((e) => e.task.pinnedAt != null);
  for (const entry of pinnedEntries) {
    const need = remainingMin(entry.task);
    const slot = { start: entry.task.pinnedAt, end: entry.task.pinnedAt + need };
    blocks.push({ type: 'task', start: slot.start, end: slot.end, taskId: entry.task.id, title: entry.task.text, kind: entry.task.kind, pinned: true });
    free = subtractIntervals(free, [slot]);
  }

  // 5b. Deep work claims its window before the small things get a chance at it.
  const deepEntries = admitted.filter((e) => e.task.kind === 'deep' && e.task.pinnedAt == null);
  for (const entry of deepEntries) {
    const need = remainingMin(entry.task);
    const slot = claimDeepSlot(free, profile, need, autonomySignals);
    if (!slot) {
      // There is no window left worth calling deep work. Say so rather than dicing it
      // into fragments that will not produce anything.
      decisions.push({
        type: 'displace_deep_work', category: 'protection', date,
        taskId: entry.task.id, task: entry.task,
        because: 'meetings left no unbroken stretch long enough for this',
      });
      deferred.push({ task: entry.task, score: entry.score, reason: 'no unbroken stretch', suggestedDate: nextWorkday(date, profile) });
      continue;
    }
    blocks.push({ type: 'task', start: slot.start, end: slot.end, taskId: entry.task.id, title: entry.task.text, kind: 'deep', protected: true });
    decisions.push({
      type: 'protect', category: 'protection', date,
      taskId: entry.task.id, task: entry.task,
      at: slot.start,
      because: 'this is the stretch of the day you said you think in',
    });
    free = subtractIntervals(free, [slot]);
  }

  // 5c. Everything else fills in around it, largest first so the awkward gaps end up
  //     holding the small admin work they are actually good for.
  const rest = admitted
    .filter((e) => e.task.kind !== 'deep' && e.task.pinnedAt == null)
    .sort((a, b) => b.score - a.score);

  for (const entry of rest) {
    const need = remainingMin(entry.task);
    const slot = firstFit(free, need);
    if (!slot) {
      deferred.push({ task: entry.task, score: entry.score, reason: 'the gaps left were too small', suggestedDate: nextWorkday(date, profile) });
      decisions.push({
        type: 'defer', category: 'deferral', date,
        taskId: entry.task.id, task: entry.task, to: nextWorkday(date, profile),
        because: 'what was left of the day came in pieces too short for this',
      });
      continue;
    }
    blocks.push({ type: 'task', start: slot.start, end: slot.end, taskId: entry.task.id, title: entry.task.text, kind: entry.task.kind });
    free = subtractIntervals(free, [slot]);
  }

  blocks.sort((a, b) => a.start - b.start || a.end - b.end);

  const committed = blocks.filter((b) => b.type === 'task').reduce((n, b) => n + (b.end - b.start), 0);
  const demanded = ready.reduce((n, t) => n + remainingMin(t), 0);

  return {
    date,
    generatedAtMin: now,
    blocks,
    deferred: deferred.map((d) => ({ taskId: d.task.id, text: d.task.text, reason: d.reason, suggestedDate: d.suggestedDate })),
    blocked: blocked.map((b) => ({ taskId: b.task.id, text: b.task.text, waitingOn: b.waitingOn })),
    decisions,
    capacity: { rawMin: rawCapacity, reserveMin: reserve, usableMin: capacity, committedMin: committed, demandedMin: demanded },
    // The honest headline: was there ever enough day for this?
    overloaded: demanded > capacity,
    overloadMin: Math.max(0, demanded - capacity),
    assumptions: {
      guessedEstimates: ready.filter((t) => t.estimateGuessed).length,
    },
  };
}

// The longest usable stretch inside a declared thinking window, falling back to the
// longest stretch anywhere once the windows are gone. Below minDeepBlock it gives up
// rather than pretending.
function claimDeepSlot(free, profile, need, signals) {
  const minBlock = Math.max(profile.minDeepBlock, signals.minDeepBlock || 0);
  const wanted = Math.max(need, minBlock);

  const inWindows = [];
  for (const span of free) {
    for (const w of profile.deepWorkWindows) {
      const start = Math.max(span.start, w.start);
      const end = Math.min(span.end, w.end);
      if (end - start >= wanted) inWindows.push({ start, end: start + need });
    }
  }
  if (inWindows.length) return inWindows.sort((a, b) => a.start - b.start)[0];

  const anywhere = free.filter((s) => intervalLength(s) >= wanted)
    .sort((a, b) => intervalLength(b) - intervalLength(a))[0];
  return anywhere ? { start: anywhere.start, end: anywhere.start + need } : null;
}

function firstFit(free, need) {
  const span = free.find((s) => intervalLength(s) >= need);
  return span ? { start: span.start, end: span.start + need } : null;
}

export function nextWorkday(date, profile) {
  let d = date;
  for (let i = 0; i < 7; i++) {
    d = require_addDays(d, 1);
    const dow = new Date(d + 'T00:00:00Z').getUTCDay();
    if (profile.workdays.includes(dow)) return d;
  }
  return require_addDays(date, 1);
}

// Kept local so this module has no import cycle with model's date helpers.
function require_addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function emptyPlan(date, profile, extra) {
  return {
    date, blocks: [], deferred: [], blocked: [], decisions: [],
    capacity: { rawMin: 0, reserveMin: 0, usableMin: 0, committedMin: 0, demandedMin: 0 },
    overloaded: false, overloadMin: 0, note: extra && extra.reason, assumptions: { guessedEstimates: 0 },
  };
}
