import { authorize, getState, putState, getWorkday, putWorkday } from './_lib.js';
import { buildDay, reconsider } from '../engine/index.js';
import { normalizeAutonomy, isFullyPassive } from '../engine/autonomy.js';
import { emptyHistory, recordOutcome } from '../engine/learning.js';
import { emptyMetrics, record, summarize } from '../engine/metrics.js';
import { toMin, dayKey } from '../engine/model.js';
import { readBody } from './_lib.js';

// GET  /api/plan?date=          -> "here's your day"
// POST /api/plan  { trigger }   -> something changed; reconsider the whole day
// PUT  /api/plan  { profile?, autonomy?, events?, effort? }
//
// The endpoint is thin on purpose. All the judgement lives in ../engine, which has no
// storage and no clock, so it can be argued with in a test rather than in production.

function emptyWorkday() {
  return {
    profile: null,                    // defaults live in the engine, not duplicated here
    autonomy: null,
    goals: [],
    events: {},                       // date -> [event]
    history: emptyHistory(),
    metrics: emptyMetrics(),
    plans: {},                        // date -> last adopted plan
    pending: [],                      // decisions waiting on a yes
    log: [],                          // what was decided, and what happened to it
  };
}

const LOG_CAP = 500;

function tasksFor(state, date) {
  const day = (state.days && state.days[date]) || [];
  // The backlog is offered to the planner as candidate work with no home of its own, so
  // an empty day pulls from it instead of sitting empty next to a full backlog.
  const backlog = (state.backlog || []).map((t) => ({ ...t, source: 'backlog' }));
  return [...day.map((t) => ({ ...t, source: 'day', date })), ...backlog];
}

export default async function handler(req, res) {
  const auth = authorize(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const uid = auth.userId;

  try {
    const wd = (await getWorkday(uid)) || emptyWorkday();
    const state = await getState(uid);
    const today = dayKey(new Date());

    if (req.method === 'GET') {
      const date = (req.query && req.query.date) || today;
      const nowMin = req.query && req.query.now != null ? Number(req.query.now) : minutesNow(req);
      const view = buildDay({
        date, nowMin,
        profile: wd.profile, goals: wd.goals,
        events: wd.events[date] || [],
        tasks: tasksFor(state, date),
        history: wd.history,
      }, { autonomy: wd.autonomy });

      res.status(200).json({
        ...view,
        pending: wd.pending.filter((p) => p.date === date),
        metrics: summarize(wd.metrics),
        // Said plainly, because the promise of the bottom rung is the thing that makes
        // the top rungs safe to try.
        passive: isFullyPassive(normalizeAutonomy(wd.autonomy)),
      });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const trigger = body && body.trigger;
      if (!trigger || !trigger.type) {
        res.status(400).json({ error: 'what happened?' });
        return;
      }
      const date = trigger.date || today;
      const nowMin = Number.isFinite(trigger.nowMin) ? trigger.nowMin : minutesNow(req);

      const result = reconsider({
        date, nowMin,
        profile: wd.profile, goals: wd.goals,
        events: wd.events[date] || [],
        tasks: tasksFor(state, date),
        history: wd.history,
      }, trigger, { autonomy: wd.autonomy, previousPlan: wd.plans[date] || null });

      // `observe` computes the better day and then declines to take it, which is the
      // whole point of that rung: it can be watched for a week before it is trusted.
      if (result.adopt) {
        wd.plans[date] = result.plan;
        if (trigger.type === 'meeting_added' || trigger.type === 'meeting_ran_long' || trigger.type === 'meeting_cancelled') {
          wd.events[date] = result.state.events;
        }
      }

      wd.pending = [
        ...wd.pending.filter((p) => p.date !== date),
        ...result.decisions.awaiting.map((d) => ({ ...d, date, id: 'd-' + Math.random().toString(36).slice(2, 10) })),
      ];

      wd.metrics = record(wd.metrics, { type: 'decisions', payload: { applied: result.decisions.applied.length } });
      if (result.recoveredMin > 0) {
        wd.metrics = record(wd.metrics, { type: 'recovered', payload: { minutes: result.recoveredMin } });
      }
      for (const c of result.changes) {
        if (c.type === 'moved' || c.type === 'pushed_out') wd.metrics = record(wd.metrics, { type: 'task_moved' });
      }
      if (trigger.type === 'manual_change') wd.metrics = record(wd.metrics, { type: 'manual_change' });

      wd.log = [
        ...wd.log,
        { at: new Date().toISOString(), date, trigger: trigger.type, applied: result.decisions.applied.length, awaiting: result.decisions.awaiting.length, adopted: result.adopt },
      ].slice(-LOG_CAP);

      await putWorkday(uid, wd);

      res.status(200).json({
        ...result.view,
        changes: result.changes,
        decisions: result.decisions,
        adopted: result.adopt,
        pending: wd.pending.filter((p) => p.date === date),
      });
      return;
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (body.profile) wd.profile = body.profile;
      if (body.autonomy) wd.autonomy = normalizeAutonomy(body.autonomy);
      if (Array.isArray(body.goals)) wd.goals = body.goals;
      if (body.events && body.date) wd.events[dayKey(body.date)] = body.events;

      // The only number in the whole system that has to come from the person.
      if (Number.isFinite(body.planningEffort)) {
        wd.metrics = record(wd.metrics, { type: 'planning_effort', payload: { score: body.planningEffort } });
      }

      // A decision that was put to them, answered.
      if (body.answer && body.answer.id) {
        const hit = wd.pending.find((p) => p.id === body.answer.id);
        if (hit) {
          wd.metrics = record(wd.metrics, { type: body.answer.accept ? 'confirmed' : 'rejected' });
          wd.pending = wd.pending.filter((p) => p.id !== body.answer.id);
        }
      }
      // The person undoing something the system did by itself. Counted apart from an
      // ordinary edit, because a rising override rate is the signal that this is not
      // working, however busy it looks.
      if (body.override) {
        wd.metrics = record(wd.metrics, { type: 'override' });
      }
      // How a scheduled block actually went, which is the only way the day learns.
      if (body.outcome && body.outcome.kind) {
        wd.history = recordOutcome(wd.history, body.outcome);
      }
      if (body.dayClosed) {
        wd.metrics = record(wd.metrics, { type: 'day_closed', payload: body.dayClosed });
      }

      await putWorkday(uid, wd);
      res.status(200).json({ ok: true, autonomy: normalizeAutonomy(wd.autonomy), metrics: summarize(wd.metrics) });
      return;
    }

    res.setHeader('Allow', 'GET, POST, PUT');
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('plan error', e);
    res.status(500).json({ error: 'server error' });
  }
}

// The workday is local to whoever is living it, so the caller says what time it is where
// they are; the server's own clock is only a fallback.
function minutesNow(req) {
  const given = req.headers && req.headers['x-local-time'];
  const parsed = given ? toMin(given) : null;
  if (parsed != null) return parsed;
  const d = new Date();
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
