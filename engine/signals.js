// The seam for everything this version deliberately does not know.
//
// Sleep, energy, recovery, wearables, stress, nutrition, environment and the rest all
// change the same small set of answers: how much should be attempted today, how long a
// thinking block needs to be, and which hours are worth protecting. Rather than let those
// eventually reach into the planner from all sides, they land here, as a signal that
// resolves to a handful of modifiers.
//
// Nothing produces signals yet. This exists so that when something does, the planner does
// not have to change to accept it, and so the shape of that future is argued about now
// while it is cheap.

import { clamp } from './model.js';

export const SIGNAL_KINDS = [
  'sleep',        // last night's duration and quality
  'energy',       // self-reported or inferred
  'recovery',     // training load, HRV
  'stress',       // state, acute or accumulated
  'nutrition',    // eaten or not
  'environment',  // where they are, how loud it is, what device
  'interruption', // how often today has been broken into
];

// What a signal is allowed to change. Kept small on purpose: a signal that can change
// anything is indistinguishable from a rewrite of the planner, and impossible to reason
// about when two of them disagree.
export const DEFAULT_MODIFIERS = {
  // Scales the planning margin. A bad night widens it; nothing shrinks it below the
  // profile's own reserve, because optimism is not a signal.
  reserveMultiplier: 1,
  // Raises the floor on what counts as a usable thinking block.
  minDeepBlock: 0,
  // Scales how much work may be admitted. Below 1 the day gets deliberately lighter.
  capacityMultiplier: 1,
  // Hours to avoid scheduling demanding work into, as [{start, end}] in minutes.
  avoid: [],
};

// Resolution is a fold, not a winner-takes-all: two mediocre signals should be able to
// add up to a lighter day, and no single one should be able to empty it. Everything is
// clamped, so a broken sensor degrades into a slightly cautious day rather than a day
// with no work in it.
export function applySignals(signals, ctx = {}) {
  const out = { ...DEFAULT_MODIFIERS, avoid: [] };
  if (!Array.isArray(signals) || !signals.length) return out;

  for (const s of signals) {
    if (!s || !SIGNAL_KINDS.includes(s.kind)) continue;
    const m = s.modifiers || {};
    if (Number.isFinite(m.reserveMultiplier)) out.reserveMultiplier *= clamp(m.reserveMultiplier, 1, 2.5);
    if (Number.isFinite(m.capacityMultiplier)) out.capacityMultiplier *= clamp(m.capacityMultiplier, 0.4, 1);
    if (Number.isFinite(m.minDeepBlock)) out.minDeepBlock = Math.max(out.minDeepBlock, m.minDeepBlock);
    if (Array.isArray(m.avoid)) out.avoid.push(...m.avoid);
  }

  out.reserveMultiplier = clamp(out.reserveMultiplier, 1, 2.5);
  out.capacityMultiplier = clamp(out.capacityMultiplier, 0.4, 1);
  out.minDeepBlock = clamp(out.minDeepBlock, 0, 180);
  out.ctx = ctx;
  return out;
}
