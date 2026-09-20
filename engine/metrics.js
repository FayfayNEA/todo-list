// Whether the experiment is working.
//
// The claim under test is "the system can run a workday better than the person can run it
// by hand". That is falsifiable, and these are the numbers that falsify it. Two of them
// are the ones to watch, because they are the ones that would show the thing failing
// while still looking busy:
//
//   overrideRate   - the plan is being rejected; it is doing cognition badly
//   manualChanges  - the work was merely moved, not taken off anyone
//
// A rising decisionsMade with a rising overrideRate is not progress. It is a system
// generating work while claiming to absorb it.

export function emptyMetrics() {
  return {
    decisionsMade: 0,        // taken by the system without being asked
    decisionsConfirmed: 0,   // put to the person, and accepted
    decisionsRejected: 0,    // put to the person, and declined
    manualChanges: 0,        // edits the person still had to make themselves
    overrides: 0,            // the system decided, the person undid it
    tasksCompleted: 0,
    minutesCompleted: 0,
    tasksMoved: 0,
    minutesRecovered: 0,     // time handed back by replanning
    overloadedDays: 0,
    overloadedDaysRescued: 0,
    planningEffortReports: [],  // 1-5, self-reported: the point of the whole exercise
    days: 0,
  };
}

export function record(metrics, event) {
  const m = { ...emptyMetrics(), ...(metrics || {}) };
  const p = event.payload || {};

  switch (event.type) {
    case 'decisions':
      m.decisionsMade += (p.applied || 0);
      break;
    case 'confirmed':
      m.decisionsConfirmed += 1;
      break;
    case 'rejected':
      m.decisionsRejected += 1;
      break;
    case 'override':
      // An override is the person telling the system it was wrong. Counted separately
      // from an ordinary edit, because the two mean opposite things.
      m.overrides += 1;
      break;
    case 'manual_change':
      m.manualChanges += 1;
      break;
    case 'task_completed':
      m.tasksCompleted += 1;
      m.minutesCompleted += p.minutes || 0;
      break;
    case 'task_moved':
      m.tasksMoved += 1;
      break;
    case 'recovered':
      m.minutesRecovered += p.minutes || 0;
      break;
    case 'day_closed':
      m.days += 1;
      if (p.overloaded) {
        m.overloadedDays += 1;
        // A rescue is not "the day was survived". It is: there was more work than time,
        // and the things that actually mattered still got done.
        if (p.topPriorityCompleted) m.overloadedDaysRescued += 1;
      }
      break;
    case 'planning_effort':
      if (Number.isFinite(p.score)) m.planningEffortReports.push({ score: p.score, at: p.at || new Date().toISOString() });
      break;
    default:
      break;
  }
  return m;
}

export function summarize(metrics) {
  const m = { ...emptyMetrics(), ...(metrics || {}) };
  const put = m.decisionsConfirmed + m.decisionsRejected;
  const touched = m.decisionsMade + put;
  const effort = m.planningEffortReports.map((r) => r.score);
  return {
    ...m,
    // Of everything the system decided, how much did the person have to re-decide.
    overrideRate: m.decisionsMade ? m.overrides / m.decisionsMade : 0,
    acceptanceRate: put ? m.decisionsConfirmed / put : null,
    // The headline: decisions carried for every change still left to the person. Above 1
    // the system is absorbing more than it creates. Null rather than Infinity when the
    // person has made no manual changes at all, because Infinity does not survive JSON
    // and a silently null headline metric is worse than an explicit one.
    leverage: m.manualChanges ? touched / m.manualChanges : null,
    leverageUnbounded: !m.manualChanges && touched > 0,
    rescueRate: m.overloadedDays ? m.overloadedDaysRescued / m.overloadedDays : null,
    averagePlanningEffort: effort.length ? effort.reduce((a, b) => a + b, 0) / effort.length : null,
    // Whether the reported cost of planning is actually falling, which is the only
    // measure here that comes from the person rather than from the software.
    planningEffortTrend: trend(effort),
  };
}

function trend(scores) {
  if (scores.length < 4) return null;
  const half = Math.floor(scores.length / 2);
  const early = scores.slice(0, half);
  const late = scores.slice(-half);
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return Number((avg(late) - avg(early)).toFixed(2));
}
