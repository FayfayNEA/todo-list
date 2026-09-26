# Executive functioning as a service

## The thesis

A to-do list is a storage format. It remembers what you told it and hands the list back
unchanged, which leaves every hard question exactly where it was: what now, what first,
what gets dropped, what happens to the afternoon now that the morning is gone.

The claim under test here is that those questions are software's job.

> **Can the system run a person's workday better than the person can run it by hand?**

That is falsifiable, which is the point. `engine/metrics.js` exists to falsify it.

The first laboratory is deliberately narrow: **the workday**. Not life, not health, not
habits. One person, nine to five, one question.

## What this is not

Not a task manager with automation bolted on. The difference shows up in what happens when
a day breaks.

| | a task manager | this |
|---|---|---|
| a meeting is added | a row appears | the day is rebuilt around it |
| a task overruns | it turns red | lower-value work moves, the estimate is revised |
| more work than hours | a longer list | a shorter list, and a note about what moved |
| 4pm deep work keeps failing | nothing | it stops being scheduled at 4pm |
| the output | your tasks | *here's your day* |

The last row is the whole product. A notification tells you something broke and leaves you
to work out the consequences. Replanning *is* the consequence, already worked out.

## The rule the code is built around

**Do the cognition. Do not narrate it.**

Every placement has a reason, and the reason is recorded, but the default output is a day
and one sentence. `headlineFor()` in `engine/index.js` is deliberately capped at something
like "4 things today, 2 moved to make them fit". The rationale is available to anyone who
asks and silent for everyone who doesn't, because a person who has handed over their
scheduling does not want a defence of every decision. They want to know what they're
doing at eleven.

## Autonomy is a permission system

This is the main safety property, and the reason the rest is safe to try.

| rung | what it means |
|---|---|
| `observe` | watches, changes nothing, ever |
| `suggest` | shows what it would do |
| `ask` | queues decisions for a yes |
| `auto_low` | acts on low-stakes things, asks about the rest |
| `delegate` | acts |

Set **per category**, because they are different sentences: letting something reorder your
afternoon is not the same as letting it move work to next week.

```
ordering     where a task sits within today
deferral     moving work off today entirely
protection   holding deep work against encroachment
estimation   revising how long something is believed to take
triage       deciding what a new arrival displaces
```

Two properties are load-bearing and tested:

- **`observe` means observe.** The better day is computed and then deliberately not
  adopted. `replan()` returns `adopt: false` and the endpoint declines to store it. You can
  watch it for a week before trusting it with anything.
- **Stakes are judged by consequence, not by size.** Sliding an admin task twenty minutes
  is low-stakes. Deferring anything due today is high-stakes however small the move, so
  `auto_low` will never do it silently.

## Dynamic replanning

The loop, in `engine/replan.js`:

```
trigger  ->  fold into the world  ->  rebuild the whole day  ->  diff against the old day
         ->  each difference becomes a decision  ->  the ladder decides what happens to it
```

The day is always rebuilt from what is now true, never patched. A patched day accumulates
the residue of every past decision; a rebuilt one is simply correct.

Triggers: `day_started`, `meeting_added`, `meeting_ran_long`, `meeting_cancelled`,
`task_added`, `task_completed`, `task_overran`, `deadline_changed`, `interruption`,
`manual_change`.

## How the day is built

`engine/planner.js`. Two rules shape almost all of it.

**1. Capacity is finite, and that is the planner's problem.** A day with more work than
hours produces a *shorter* list, not a longer one. Work is admitted in score order until
the budget is gone; the rest is deferred with a date and a reason. A reserve
(`reserveRatio`, default 12%) is held back, because a day booked to the minute breaks on
the first five-minute surprise and the person pays for that in scramble.

**2. Deep work is claimed before anything else is placed.** Left to a greedy pass it loses
every time to a pile of small urgent things, which is precisely the failure people ask to
be protected from. If meetings have left no unbroken stretch, it says so and moves the work
rather than dicing it into fragments that will not produce anything.

Scoring is legible rather than tuned, because it is a stated policy about what matters and
should be arguable:

```
priority 30 · urgency 34 · goal alignment 14 · blocking others 10 · staleness 6 · fit 6
```

## What the day teaches

`engine/learning.js` counts. It does not predict.

"You have started deep work at 4pm eleven times and finished it twice" is a fact about a
person, and it is enough to stop scheduling deep work at 4pm. Anything cleverer would be
guessing with more decimal places and much harder to argue with when wrong. Estimates are
pulled toward 0.5 until there is real evidence: three bad afternoons is a mood, twelve is a
pattern.

It also tracks estimate bias per kind of work, so plans can quietly widen their margins
instead of asking people to estimate better, which they will not do.

## Measuring whether it works

`engine/metrics.js`. Two of these matter more than the rest, because they are what would
show the thing failing while still looking busy:

- **`overrideRate`**: the plan is being rejected. It is doing cognition, badly.
- **`manualChanges`**: the work was moved, not taken off anyone.

A rising `decisionsMade` alongside a rising `overrideRate` is not progress. It is a system
generating work while claiming to absorb it. `leverage` (decisions carried per manual
change still required) is the summary: above 1, it is absorbing more than it creates.

`planningEffort` is the only number that comes from the person rather than the software,
and it is the one the thesis actually rests on.

## Built to extend, not extended

`engine/signals.js` is the seam for sleep, energy, recovery, wearables, stress, nutrition,
environment. **Only stress is built**, as a one-tap check-in on the day. The file exists so that when they arrive the
planner does not have to change to accept them, and so the shape of that future gets
argued about now while it is cheap.

Every one of those inputs changes the same small set of answers: how much to attempt, how
long a thinking block needs to be, which hours to protect. So they resolve to four
modifiers (`reserveMultiplier`, `capacityMultiplier`, `minDeepBlock`, `avoid`) and
nothing else. A signal that can change anything is indistinguishable from a rewrite of the
planner and impossible to reason about when two of them disagree. Resolution is a fold:
two mediocre signals can add up to a lighter day, no single one can empty it, and a broken
sensor degrades into a slightly cautious day.

## Shape of the code

```
engine/          pure. no storage, no network, no clock of its own.
  model.js       the vocabulary: tasks, events, profile, goals, intervals
  planner.js     builds the day
  replan.js      the loop: trigger -> rebuild -> diff -> decisions
  autonomy.js    the ladder, and what counts as low-stakes
  learning.js    what the day keeps teaching
  metrics.js     whether the experiment is working
  signals.js     the seam for everything not built yet
  index.js       buildDay() / reconsider()

api/plan.js      thin. GET the day, POST a trigger, PUT the levers.
```

The engine is pure so its judgement can be checked: it runs a thousand times in a test with
no fixtures. All of the above is covered by 39 engine tests and 22 endpoint tests.

The checklist keeps exactly the shape it has always had. The workday lives beside it in its
own file, so someone who turns none of this on is carrying none of it.

## What is deliberately missing

The engine can reason about estimates, priorities, deadlines, dependencies, kinds of work,
working hours, goals and calendar events. **The current interface can capture almost none
of that.** A task today is `{ text, done, category }`.

So the honest state is: the cognition exists and is tested, and it is currently reasoning
from defaults. Closing that gap is the next decision, and it is a product decision rather
than a technical one. The smallest version is inferring estimates and priority from what
someone already does, rather than adding six fields to a form nobody wants to fill in.

## The question behind the question

> What else is currently living inside the human brain purely because software hasn't yet
> learned how to carry it?

Scheduling is the first answer and the easiest one. The interesting answers are the things
people do not notice they are doing: remembering that a task is only worth starting before
lunch, knowing which meeting is the one that can be moved, sensing that a day has already
failed by 10am and quietly abandoning the plan rather than spending until 5pm pretending.

Each of those is a candidate for the same treatment: name it, model it, measure whether
carrying it actually helped.
