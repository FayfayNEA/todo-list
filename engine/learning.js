// What the day keeps teaching that nobody writes down.
//
// This is counting, not prediction. "You have started deep work at 4pm eleven times and
// finished it twice" is a fact about the person, and it is enough to stop scheduling
// deep work at 4pm. Anything fancier would be guessing with more decimal places, and
// would be much harder to argue with when it is wrong.

import { clamp } from './model.js';

export const BUCKETS = [
  { id: 'early',     start: 6 * 60,  end: 9 * 60 },
  { id: 'morning',   start: 9 * 60,  end: 12 * 60 },
  { id: 'midday',    start: 12 * 60, end: 14 * 60 },
  { id: 'afternoon', start: 14 * 60, end: 17 * 60 },
  { id: 'evening',   start: 17 * 60, end: 22 * 60 },
];

export function bucketOf(mins) {
  const hit = BUCKETS.find((b) => mins >= b.start && mins < b.end);
  return hit ? hit.id : 'evening';
}

export function emptyHistory() {
  return { byKindBucket: {}, estimateBias: {}, updatedAt: null };
}

const key = (kind, bucket) => `${kind}@${bucket}`;

// One scheduled block, one observation.
export function recordOutcome(history, { kind, startMin, completed, estimateMin, actualMin, at }) {
  const h = history && history.byKindBucket ? history : emptyHistory();
  const bucket = bucketOf(startMin);
  const k = key(kind || 'shallow', bucket);
  const cell = h.byKindBucket[k] || { attempts: 0, completed: 0 };
  cell.attempts += 1;
  if (completed) cell.completed += 1;
  h.byKindBucket[k] = cell;

  // How wrong the estimates for this kind of work tend to be, tracked as a running ratio
  // so a plan can quietly widen them instead of asking the person to estimate better.
  if (Number.isFinite(estimateMin) && estimateMin > 0 && Number.isFinite(actualMin) && actualMin > 0) {
    const b = h.estimateBias[kind || 'shallow'] || { n: 0, ratio: 1 };
    b.ratio = (b.ratio * b.n + actualMin / estimateMin) / (b.n + 1);
    b.n += 1;
    h.estimateBias[kind || 'shallow'] = b;
  }
  h.updatedAt = at || new Date().toISOString();
  return h;
}

// Odds in [0,1], pulled toward 0.5 until there is enough evidence to be worth acting on.
// Three bad afternoons is a mood; twelve is a pattern.
const PRIOR_STRENGTH = 4;

export function completionOdds(history, kind, bucketOrMin) {
  if (!history || !history.byKindBucket) return 0.5;
  const bucket = typeof bucketOrMin === 'number' ? bucketOf(bucketOrMin) : bucketOrMin;
  if (!bucket) return 0.5;
  const cell = history.byKindBucket[key(kind || 'shallow', bucket)];
  if (!cell || !cell.attempts) return 0.5;
  return (cell.completed + 0.5 * PRIOR_STRENGTH) / (cell.attempts + PRIOR_STRENGTH);
}

// How much to inflate an estimate for this kind of work, given how past ones went.
export function estimateFactor(history, kind) {
  const b = history && history.estimateBias && history.estimateBias[kind || 'shallow'];
  if (!b || b.n < 3) return 1;
  return clamp(b.ratio, 0.75, 2);
}

// The patterns worth saying out loud, when asked. Deliberately a small number of strong
// statements rather than a dashboard of weak ones.
export function findings(history, { minAttempts = 6, edge = 0.2 } = {}) {
  if (!history || !history.byKindBucket) return [];
  const out = [];
  for (const [k, cell] of Object.entries(history.byKindBucket)) {
    if (cell.attempts < minAttempts) continue;
    const rate = cell.completed / cell.attempts;
    if (rate <= 0.5 - edge) {
      const [kind, bucket] = k.split('@');
      out.push({ kind, bucket, rate, attempts: cell.attempts, says: 'avoid' });
    } else if (rate >= 0.5 + edge) {
      const [kind, bucket] = k.split('@');
      out.push({ kind, bucket, rate, attempts: cell.attempts, says: 'favour' });
    }
  }
  return out.sort((a, b) => Math.abs(b.rate - 0.5) - Math.abs(a.rate - 0.5));
}
