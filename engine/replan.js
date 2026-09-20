// Reconsidering the day, rather than announcing that it broke.
//
// This is the behaviour the whole product turns on. When something changes, the ordinary
// response of a task app is to add a row and let the person work out the consequences.
// Here the change re-enters the planner, the whole day is built again from what is now
// true, and the difference between the old day and the new one is the set of decisions
// that were taken on the person's behalf.
//
// A notification says "this meeting was added". Replanning says "here's your day".

import { planDay } from './planner.js';
import { verdictFor, stakesOf } from './autonomy.js';
import { normalizeTask } from './model.js';

export const TRIGGERS = [
  'day_started',
  'meeting_added',
  'meeting_ran_long',
  'meeting_cancelled',
  'task_added',
  'task_completed',
  'task_overran',
  'deadline_changed',
  'interruption',
  'manual_change',
];

// Fold a trigger into the world, then rebuild the day from it. Triggers describe what
// happened, not what to do about it: working out what to do about it is the point.
export function applyTrigger(state, trigger) {
  const s = {
    ...state,
    events: [...(state.events || [])],
    tasks: [...(state.tasks || [])],
  };
  const p = trigger.payload || {};

  switch (trigger.type) {
    case 'meeting_added':
      s.events.push({ id: p.id || 'e-' + Date.now().toString(36), title: p.title || 'meeting', start: p.start, end: p.end });
      break;

    case 'meeting_ran_long': {
      const e = s.events.find((x) => x.id === p.id);
      if (e) e.end = p.end;
      break;
    }

    case 'meeting_cancelled':
      s.events = s.events.filter((x) => x.id !== p.id);
      break;

    case 'task_added':
      s.tasks.push(normalizeTask(p.task || p, { date: state.date }));
      break;

    case 'task_completed': {
      const t = s.tasks.find((x) => x.id === p.id);
      if (t) { t.done = true; t.completedAtMin = p.atMin ?? null; }
      break;
    }

    case 'task_overran': {
      // The task is not late, the estimate was wrong. Record the time actually spent and
      // let the rest of the day absorb it, which is what a person does badly under
      // pressure and a planner does instantly.
      const t = s.tasks.find((x) => x.id === p.id);
      if (t) {
        t.spentMin = Math.max(t.spentMin || 0, p.spentMin || 0);
        if (Number.isFinite(p.newEstimateMin)) t.estimateMin = p.newEstimateMin;
        else if (t.spentMin >= t.estimateMin) t.estimateMin = t.spentMin + Math.round(t.estimateMin * 0.5);
      }
      break;
    }

    case 'deadline_changed': {
      const t = s.tasks.find((x) => x.id === p.id);
      if (t) t.deadline = p.deadline || null;
      break;
    }

    case 'interruption':
      // Time is simply gone. Taking it off the clock is more honest than pretending the
      // day still starts where it did.
      s.nowMin = (s.nowMin ?? 0) + (p.minutes || 0);
      break;

    default:
      break;
  }

  if (Number.isFinite(p.nowMin)) s.nowMin = p.nowMin;
  return s;
}

// What changed between two versions of the day, in the terms a person would use.
export function diffPlans(before, after) {
  const changes = [];
  const beforeTasks = new Map((before?.blocks || []).filter((b) => b.type === 'task').map((b) => [b.taskId, b]));
  const afterTasks = new Map((after?.blocks || []).filter((b) => b.type === 'task').map((b) => [b.taskId, b]));
  const beforeDeferred = new Set((before?.deferred || []).map((d) => d.taskId));
  const afterDeferred = new Set((after?.deferred || []).map((d) => d.taskId));

  for (const [id, block] of afterTasks) {
    const was = beforeTasks.get(id);
    if (!was) {
      if (beforeDeferred.has(id)) changes.push({ type: 'pulled_in', taskId: id, title: block.title, at: block.start });
      continue;
    }
    if (was.start !== block.start) {
      changes.push({ type: 'moved', taskId: id, title: block.title, from: was.start, to: block.start });
    }
  }
  for (const [id, block] of beforeTasks) {
    if (afterDeferred.has(id)) changes.push({ type: 'pushed_out', taskId: id, title: block.title, from: block.start });
    else if (!afterTasks.has(id)) changes.push({ type: 'dropped', taskId: id, title: block.title });
  }
  return changes;
}

// The whole loop: take what happened, rebuild the day, and sort the consequences into
// what was done, what needs a yes, and what is only being mentioned.
export function replan(state, trigger, options = {}) {
  const autonomy = options.autonomy || {};
  const before = options.previousPlan || planDay(state);
  const next = applyTrigger(state, trigger);
  const after = planDay(next);

  const changes = diffPlans(before, after);

  // A decision per consequence, so that the ladder governs outcomes rather than internals.
  const raw = [
    ...after.decisions,
    ...changes.map((c) => toDecision(c, after.date)),
  ].filter(Boolean);

  const applied = [], awaiting = [], shown = [], recorded = [];
  for (const d of raw) {
    const decision = { ...d, stakes: d.stakes || stakesOf(d, { date: after.date }) };
    const verdict = verdictFor(decision, autonomy, { date: after.date });
    const entry = { ...decision, verdict: verdict.action, level: verdict.level };
    if (verdict.action === 'apply') applied.push(entry);
    else if (verdict.action === 'confirm') awaiting.push(entry);
    else if (verdict.action === 'show') shown.push(entry);
    else recorded.push(entry);
  }

  // Under `observe` nothing may take effect, so the rebuilt day is computed and then
  // deliberately not adopted. The promise of that rung is worth more than the plan.
  const passive = applied.length === 0 && awaiting.length === 0 && shown.length === 0 && raw.length > 0;

  return {
    trigger: trigger.type,
    state: next,
    plan: after,
    previous: before,
    changes,
    decisions: { applied, awaiting, shown, recorded },
    adopt: !passive || raw.length === 0,
    // Time handed back by rebuilding: the gap that closed when the day was reflowed
    // rather than left with a hole in it.
    recoveredMin: Math.max(0, (after.capacity.committedMin || 0) - (before?.capacity?.committedMin || 0)),
  };
}

function toDecision(change, date) {
  if (change.type === 'moved') {
    return {
      type: 'reorder', category: 'ordering', date,
      taskId: change.taskId, title: change.title, from: change.from, to: change.to,
      because: 'the day around it changed',
    };
  }
  if (change.type === 'pushed_out') {
    return {
      type: 'defer', category: 'deferral', date,
      taskId: change.taskId, title: change.title,
      because: 'something fixed took the time this was in',
    };
  }
  if (change.type === 'pulled_in') {
    return {
      type: 'reorder', category: 'triage', date,
      taskId: change.taskId, title: change.title, to: change.at,
      because: 'room opened up',
    };
  }
  return null;
}
