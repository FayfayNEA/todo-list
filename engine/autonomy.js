// How much of the day the person has handed over.
//
// The ladder is the product's main safety property. Everything the planner concludes is
// expressed as a decision, and a decision only touches the day if the level for its
// category allows it. Turning the system down to `observe` must leave the day exactly as
// the person left it, which is what makes turning it up safe to try.

export const LEVELS = ['observe', 'suggest', 'ask', 'auto_low', 'delegate'];

export const LEVEL_RANK = LEVELS.reduce((m, l, i) => ({ ...m, [l]: i }), {});

// Categories are the unit of trust. Somebody may happily let the system reorder their
// afternoon while never letting it defer work to tomorrow, and those are different
// sentences.
export const CATEGORIES = [
  'ordering',      // where a task sits within today
  'deferral',      // moving work off today entirely
  'protection',    // holding deep work against encroachment
  'estimation',    // revising how long something is believed to take
  'triage',        // deciding what a new arrival displaces
];

export const DEFAULT_AUTONOMY = {
  ordering: 'auto_low',
  deferral: 'ask',
  protection: 'auto_low',
  estimation: 'suggest',
  triage: 'ask',
};

export function normalizeAutonomy(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const c of CATEGORIES) {
    out[c] = LEVELS.includes(a[c]) ? a[c] : DEFAULT_AUTONOMY[c];
  }
  return out;
}

// Stakes decide what "low-stakes" means at the auto_low rung, and they are judged on
// consequence rather than on how much the plan moved. Sliding an admin task twenty
// minutes is nothing; moving work that is due today is not, however small the move.
export function stakesOf(decision, ctx = {}) {
  const { task, date } = decision;
  if (decision.type === 'defer') {
    if (task && task.deadline && task.deadline <= (date || ctx.date)) return 'high';
    if (task && task.priority <= 2) return 'high';
    return 'medium';
  }
  if (decision.type === 'displace_deep_work') return 'high';
  if (decision.type === 'protect') return 'low';
  if (decision.type === 'reorder') {
    if (task && task.kind === 'deep') return 'medium';
    return 'low';
  }
  if (decision.type === 'revise_estimate') return 'low';
  if (decision.type === 'shorten') return task && task.priority <= 2 ? 'high' : 'medium';
  return 'medium';
}

// The one place that answers "may this happen by itself?".
export function verdictFor(decision, autonomy, ctx = {}) {
  const level = (autonomy && autonomy[decision.category]) || 'suggest';
  const stakes = decision.stakes || stakesOf(decision, ctx);
  if (level === 'observe') return { action: 'record', stakes, level };
  if (level === 'suggest') return { action: 'show', stakes, level };
  if (level === 'ask') return { action: 'confirm', stakes, level };
  if (level === 'auto_low') {
    return { action: stakes === 'low' ? 'apply' : 'confirm', stakes, level };
  }
  return { action: 'apply', stakes, level };
}

// `observe` is the promise that nothing changes. It is worth being able to ask that
// question of a whole settings object in one call, rather than trusting five of them.
export function isFullyPassive(autonomy) {
  return CATEGORIES.every((c) => autonomy[c] === 'observe');
}
