// The vocabulary the day is reasoned about in.
//
// A task in this app has always been { id, text, done, category }. Everything here is
// additive and optional: an untouched task still schedules, using defaults that are
// deliberately dull rather than clever. Guessing an estimate from the wording of a title
// would be a confident lie, and the planner's decisions are only as good as its inputs,
// so an unknown stays an unknown and is marked as one.

export const MINUTES = 1;
export const HOUR = 60;

// ---------- time ----------
// One day is reasoned about as minutes from midnight: comparisons and arithmetic are
// integers, and time zones stop mattering because a workday is always local to whoever
// is living it.
export function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function toClock(mins) {
  const m = Math.max(0, Math.round(mins));
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

export function dayKey(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00Z').getTime();
  const b = new Date(toStr + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

// ---------- the shapes ----------
export const KINDS = ['deep', 'shallow', 'admin'];

// How long an unestimated task is assumed to take. A wrong estimate is visible and
// correctable; a missing one stops the day being plannable at all.
export const DEFAULT_ESTIMATE = { deep: 90, shallow: 30, admin: 15 };

export function normalizeTask(raw, opts = {}) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const kind = KINDS.includes(t.kind) ? t.kind : 'shallow';
  const estimated = Number.isFinite(t.estimateMin) && t.estimateMin > 0;
  return {
    id: String(t.id || ''),
    text: String(t.text || ''),
    done: !!t.done,
    category: t.category === 'personal' ? 'personal' : 'work',
    kind,
    // `estimateGuessed` travels with the task so the planner can widen its margins on a
    // day built out of guesses, and so a report can say how much of the plan is assumed.
    estimateMin: estimated ? Math.round(t.estimateMin) : DEFAULT_ESTIMATE[kind],
    estimateGuessed: !estimated,
    // 1 is the most important. Bounded, because an unbounded priority becomes a second
    // estimate field that everyone sets to the maximum.
    priority: clamp(Number.isFinite(t.priority) ? t.priority : 3, 1, 5),
    deadline: t.deadline ? dayKey(t.deadline) : null,
    // Ids of tasks that must be finished first.
    blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy.map(String).filter(Boolean) : [],
    // A task the person has placed by hand, which the planner will not move.
    pinnedAt: Number.isFinite(t.pinnedAt) ? t.pinnedAt : (toMin(t.pinnedAt) ?? null),
    goalIds: Array.isArray(t.goalIds) ? t.goalIds.map(String) : [],
    // Minutes already spent, so a task resumed after an interruption asks for what is
    // left rather than for the whole thing again.
    spentMin: Number.isFinite(t.spentMin) ? Math.max(0, t.spentMin) : 0,
    date: t.date ? dayKey(t.date) : (opts.date || null),
    source: t.source || 'day',
  };
}

export function remainingMin(task) {
  return Math.max(0, task.estimateMin - task.spentMin);
}

export function normalizeEvent(raw) {
  const e = raw && typeof raw === 'object' ? raw : {};
  const start = Number.isFinite(e.start) ? e.start : toMin(e.start);
  const end = Number.isFinite(e.end) ? e.end : toMin(e.end);
  if (start == null || end == null || end <= start) return null;
  return {
    id: String(e.id || ''),
    title: String(e.title || 'meeting'),
    start,
    end,
    // A movable event is one the planner may shift; almost none are, which is the whole
    // reason a calendar hurts.
    movable: !!e.movable,
    kind: 'event',
  };
}

// The shape of a working day: when it runs, and what it is for.
export function normalizeProfile(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const start = toMin(p.startsAt) ?? 9 * 60;
  const end = toMin(p.endsAt) ?? 17 * 60 + 30;
  const windows = Array.isArray(p.deepWorkWindows) ? p.deepWorkWindows : [{ start: '09:30', end: '12:00' }];
  return {
    startsAt: start,
    endsAt: Math.max(end, start + 60),
    workdays: Array.isArray(p.workdays) && p.workdays.length ? p.workdays : [1, 2, 3, 4, 5],
    // The hours the person is actually able to think, declared once rather than fought
    // for every morning.
    deepWorkWindows: windows
      .map((w) => ({ start: toMin(w.start) ?? toMin('09:30'), end: toMin(w.end) ?? toMin('12:00') }))
      .filter((w) => w.end > w.start),
    // Deep work below this length is not deep work, it is an interruption with a title.
    minDeepBlock: Number.isFinite(p.minDeepBlock) ? p.minDeepBlock : 50,
    // Breathing room after a meeting, so back-to-back commitments don't silently assume
    // teleportation.
    bufferMin: Number.isFinite(p.bufferMin) ? p.bufferMin : 10,
    lunch: p.lunch === null ? null : {
      start: toMin((p.lunch && p.lunch.start) || '12:30'),
      end: toMin((p.lunch && p.lunch.end) || '13:00'),
    },
    // Planning margin: a day packed to 100% of capacity fails on contact with reality.
    reserveRatio: Number.isFinite(p.reserveRatio) ? clamp(p.reserveRatio, 0, 0.5) : 0.12,
  };
}

export function normalizeGoal(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(g.id || ''),
    text: String(g.text || ''),
    weight: clamp(Number.isFinite(g.weight) ? g.weight : 1, 0, 3),
    // Goals can speak in terms of kinds of work as well as named tasks, which is how
    // "deep work matters to me" becomes something the scheduler can act on.
    kinds: Array.isArray(g.kinds) ? g.kinds.filter((k) => KINDS.includes(k)) : [],
  };
}

export function clamp(n, lo, hi) {
  return Math.min(Math.max(Number.isFinite(n) ? n : lo, lo), hi);
}

// ---------- intervals ----------
// Free time is the workday with everything immovable cut out of it. Every scheduling
// question reduces to this, so it is worth having exactly one implementation.
export function subtractIntervals(base, cuts) {
  let out = base.map((b) => ({ ...b }));
  for (const cut of cuts) {
    const next = [];
    for (const span of out) {
      if (cut.end <= span.start || cut.start >= span.end) { next.push(span); continue; }
      if (cut.start > span.start) next.push({ ...span, start: span.start, end: cut.start });
      if (cut.end < span.end) next.push({ ...span, start: cut.end, end: span.end });
    }
    out = next;
  }
  return out.filter((s) => s.end > s.start);
}

export function intervalLength(s) {
  return Math.max(0, s.end - s.start);
}

export function totalMinutes(spans) {
  return spans.reduce((n, s) => n + intervalLength(s), 0);
}

export function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}
