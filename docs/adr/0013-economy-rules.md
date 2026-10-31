# ADR 0013: The economy's rules

Status: accepted, 31 October 2026 (Phase 4)

## Decision

The rules are pure functions in `packages/domain/src/economy.ts`, property-tested with fast-check, and the only place the economy decides anything. The ledger records; the worker and api call these.

- **The week** runs from the household's reset (`SUN 18:00` by default) in its own time zone, so 18:00 stays 18:00 across a clock change and that week is an hour longer or shorter.
- **The allowance** is given at the reset as TIME. It does not roll over.
- **The week close** happens in the worker at the reset, or at its next run if the server was down then: first the unused-time bonus (per full 30 minutes, up to the weekly cap) when the pilot phase has it on, then the rest of the TIME expires, then a reduction step if one is due and was ticked agreed at the family review, then the new allowance. Each step is once only, by its reference.
- **A reduction step** happens only when it is due and was ticked agreed for that date. A step agreed late applies at the next week. Never below the floor, never upwards.
- **Earned screen time** from jobs and flex conversion is capped at 15% of the weekly allowance. An approval that would go over pays what is left of the cap, and the card says so before the tap. Nothing converts to money automatically.
- **Planning** is in 30-minute blocks, for today, inside free time, within the daily and single-session caps, and only with enough TIME left. Reasons are written for the child.
- **A parent stepping in**: a Block or Pause during a planned session takes those minutes back to the child as TIME when the session ends. An Allow that counts in weekly time is charged for the minutes it actually ran, when it ends, and never takes TIME below zero.
- **A request** approved from the allowance spends its TIME at once. When the allowance has run out a parent (not a carer) can say yes as extra time, which costs nothing and is worded as such.
- **The pilot phase** switches features without code changes: baseline (none), reframe (allowance, jobs, approvals, planning), reward-less (adds the bonus and the savings goal), transitions, taper (reduction steps apply).

## Why

Brief Parts 4, 6 and 14, and the motivation research's recommendations: the allowance is agreed, not earned; under-use is rewarded, not over-use; reductions are small and agreed; screen time stays a plan, not a prize.

## Consequences

- Changing a rule means changing one function and its tests, and the simulated fortnight (`apps/api/test/simulated-week.test.ts`) shows the effect end to end.
- Requests and planning share one check, so a parent cannot approve a session inside wind-down or bedtime, where the control engine would block it anyway. They use Allow on Control for that.
