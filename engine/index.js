// The one call the rest of the app makes.
//
// Everything above this line is a pure function of what it is given: no storage, no
// network, no clock of its own. That is deliberate. The planner is the part that has to
// be argued with, and a thing that can be run a thousand times in a test with no fixtures
// is a thing whose judgement can actually be checked.

export * from './model.js';
export * from './autonomy.js';
export * from './planner.js';
export * from './replan.js';
export * from './learning.js';
export * from './metrics.js';
export * from './signals.js';

import { planDay } from './planner.js';
import { replan } from './replan.js';
import { normalizeAutonomy } from './autonomy.js';
import { toClock } from './model.js';

// "Here's your day." The shape a caller renders, with the reasoning left behind rather
// than recited: a person who has handed over their scheduling does not want a defence of
// every placement, they want to know what they are doing at eleven.
export function buildDay(state, options = {}) {
  const autonomy = normalizeAutonomy(options.autonomy);
  const plan = planDay(state);
  return present(plan, autonomy);
}

export function reconsider(state, trigger, options = {}) {
  const autonomy = normalizeAutonomy(options.autonomy);
  const result = replan(state, trigger, { ...options, autonomy });
  return { ...result, view: present(result.plan, autonomy) };
}

function present(plan, autonomy) {
  const lines = plan.blocks.map((b) => ({
    at: toClock(b.start),
    until: toClock(b.end),
    minutes: b.end - b.start,
    type: b.type,
    title: b.title,
    taskId: b.taskId || null,
    kind: b.kind || null,
    protected: !!b.protected,
  }));

  return {
    date: plan.date,
    lines,
    // One sentence, not a rationale. The detail is available to anyone who asks for it,
    // and silent for everyone who does not.
    headline: headlineFor(plan),
    moved: plan.deferred.map((d) => ({ taskId: d.taskId, title: d.text, to: d.suggestedDate })),
    waiting: plan.blocked,
    overloaded: plan.overloaded,
    autonomy,
    capacity: plan.capacity,
  };
}

function headlineFor(plan) {
  const tasks = plan.blocks.filter((b) => b.type === 'task').length;
  const moved = plan.deferred.length;
  if (!tasks && !moved) return 'nothing scheduled';
  if (plan.overloaded && moved) {
    return `${tasks} things today, ${moved} moved to make them fit`;
  }
  if (moved) return `${tasks} things today, ${moved} moved`;
  return `${tasks} things today`;
}
