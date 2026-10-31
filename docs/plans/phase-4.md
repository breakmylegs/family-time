# Phase 4 plan: the economy on a Postgres ledger

Branch `phase-4`, from `phase-3` once you have approved Phase 3. Waiting for your approval. Nothing here touches your network.

## Goal

The weekly allowance, jobs, praise, requests, planned sessions, the unused-time bonus, the reduction plan and payouts all work, on a ledger that cannot be quietly changed. Mum approves jobs and requests from the app, with a note of praise.

## Exit criteria

1. Here: a full simulated week passes with the fake clock, on the Postgres ledger, from Sunday's reset to the next. It covers the allowance, planned sessions, a Block that pauses a session and refunds the unused minutes, jobs paid in money, flex and capped time, a praise-only job, a request approved, the week close with the bonus (cap reached and not), a reduction step that was ticked "agreed at the review" (and one that was not, which does not happen), a payout, a daylight saving change, and chain verification. The same test runs on the real Postgres in `update.sh`'s test stage.
2. Here: Playwright in WebKit drives Approvals (approve with a note, Not yet, Send praise, approve a request, Undo), Tasks (create and edit, with the 15% time cap visible) and Family (tick a step agreed, mark a payout), with screenshots in light and dark. The four reviews run again and their findings are fixed.
3. On your phones, later: Mum approves a job with a note and a request, unaided, and the note and balances are right.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | `packages/ledger` defines `LedgerPort` exactly as brief Part 7 lists it: award, allocateAllowance, spendTime, refund, convert, closeWeek, recordPayout, balances, history, verify. Every call takes an idempotency reference; a reference used twice returns the first result and writes nothing | One interface for both adapters, so Phase 5's Besu adapter must pass the same tests |
| 2 | Currencies: TIME in minutes, MONEY in pence, FLEX in points. Accounts are per child | Brief Part 7 |
| 3 | The Postgres adapter: one append-only `ledger_entries` table. Each row stores the SHA-256 of the previous row's hash plus the canonical JSON of the entry (sorted keys, no spaces, our own small function). Writes are serialised by a Postgres advisory lock held for the transaction, so the api gets an answer at once. A trigger refuses UPDATE and DELETE, as the audit log's does. Nightly verification walks the chain and alerts the owner on a break | Brief Part 7. The advisory lock is the single writer without a queue round trip; the Besu adapter keeps the queue in Phase 5 |
| 4 | The same table is the read model Phase 5's indexer fills from the chain, with nullable block number and transaction hash | One history screen for both adapters |
| 5 | There is no "deduct" entry. The only ways points go down are the child's own plan (spend), the week close (unused TIME becomes MONEY, the rest expires), a payout, a conversion the child or a parent chose, and a correction. A correction can only reverse one earlier entry exactly, and the app calls it "Fix a mistake" | Brief Parts 6 and 22: no punishments through the ledger, by construction rather than by policy |
| 6 | Economy rules are pure functions in `packages/domain`, test-first with fast-check: the allowance, the 15% earned-time cap, the bonus (rate per full 30 minutes, weekly cap), the reduction step (only when ticked agreed, never below the floor), and planning limits (30-minute blocks, allowed windows only, daily cap, single-session cap, enough TIME left) | Same pattern as the control engine. The simulated week is mostly these functions |
| 7 | Planning makes a grant and spends its TIME in one transaction. A parent Block on that app during the session pauses the grant; when the Block ends, the minutes it took are refunded as TIME by a ledger refund entry. A refund as flex points is a separate parent action behind a confirmation sheet | Brief Parts 4, 6 and 9 |
| 8 | The week closes in the worker at the household's reset (`SUN 18:00` by default), in its time zone, once per child per week (reference `week:<child>:<date>`), even if the worker was down at that moment: the next run catches up. Order: bonus, expire the remaining TIME, apply an agreed reduction step, allocate the new allowance | Brief Part 6. Catching up matters on a home server that restarts |
| 9 | Jobs: tasks with a picture from a fixed set (no uploads yet), reward type money, flex, time or praise only, amount, recurrence (once, daily, chosen weekdays), age band, and "needs a photo". The editor defaults to money, shows the time cap and how much of it is left this week, and has the (?) for earning screen time and for praise only | Brief Parts 6 and 9 |
| 10 | Approvals from the mock: completions, praise-only items and requests in one list, with three suggested phrases per item, Approve, Not yet and Send praise, collapsing on decision with a 10-second Undo. "Not yet" is not a refusal and costs nothing; the child can log it again | Brief Part 9 |
| 11 | The child's side (plan a session, I did it, ask a grown-up, convert flex) is built as server functions now and driven by the tests; the kiosk's screens and its device-token API are Phase 6. Photos for "I did it" arrive with the kiosk camera in Phase 6 | Keeps each phase to one surface. The economy can be fully tested without the kiosk |
| 12 | Push to parents for a new completion and a new request, opening Approvals. Nightly chain verification alerts the owner only | Brief Part 12 |
| 13 | The pilot phase switches features without code changes: baseline (logging only, no economy screens), reframe (allowance, jobs in money and flex, approvals), reward-less (adds the bonus and the savings goal), transitions, taper (reduction steps can apply). Set with `./scripts/ft.sh pilot-phase reframe` and shown in Settings | Brief Part 14 |
| 14 | Screens: Approvals, Tasks and Family join the tab bar (five tabs, as in the mock), with the Approvals badge. Control gains "This week" from the mock: time left as 30-minute blocks, last week's bonus, the next reduction step | Phase 3 decision 1 deferred these until they do something |
| 15 | Defaults, all editable: allowance 7 h (your VALUES), bonus 10p per full 30 minutes with a £1 weekly cap, reduction 30 minutes every 4 weeks with a 5 h floor (the mock's numbers), flex rates 1 point = 1p and 1 point = 1 minute of TIME (the latter inside the 15% cap) | From the brief's VALUES and the mock |

## Open questions, with what I recommend

1. **"Count it in weekly time" on an Allow.** Recommend: charge the minutes it actually ran when it ends (Normal early charges less), and never take TIME below zero. A parent's Allow should not leave the child in debt.
2. **Pause everything during a planned session.** Recommend: treat it like a Block on that app, so the session pauses and the lost minutes come back as TIME. A routine pause (tea) cannot be planned over, so it never applies there.
3. **Earned TIME cap reached.** Recommend: the approval card says so before you tap ("15 minutes of this week's earned time left"), and approving pays what is left of the cap. Nothing converts to money automatically, which would be a reward the system chose.
4. **A request when the allowance has run out.** Recommend: the card offers "Yes, as extra time" (not counted), worded as such, alongside "Not tonight". Never a negative balance.
5. **Who converts flex points.** Recommend: the child asks on the kiosk (Phase 6) and a parent approves; until then a parent can convert from Family.
6. **Parental matching on the savings goal** (a nice-to-have in the brief). Recommend: leave it for later.

## Still open from Phase 3

The six decisions in the Phase 3 report, above all the "Count it in weekly time" default (on, as now, or off, as in the mock), and the seven help topics marked needs review.

## Dependencies

None new. SHA-256 is Node's own `crypto`; canonical JSON is a few lines of our own.

## Files

- `packages/ledger` (new): `LedgerPort`, the Postgres adapter, canonical JSON and hashing, verification, and the adapter test suite Phase 5 reuses.
- `packages/domain`: `economy.ts` (allowance, cap, bonus, reduction, planning limits) with property tests, and the simulated week.
- `packages/db`: migration `0006`: ledger entries (append-only trigger), tasks, completions, requests, savings goals, reduction plans, economy settings per child and household, week closes. Additive only.
- `packages/schemas`: tasks, completions, requests, approvals, balances, week summary.
- `apps/api`: tasks, approvals (approve, not yet, praise, undo), requests, the week summary, payouts, flex conversion, corrections, the pilot phase; CLI `pilot-phase`, `allowance`, `ledger-verify`.
- `apps/worker`: week close with catch-up, grant pause and refund, nightly chain verification, alerts for completions and requests.
- `apps/parent`: Approvals, Tasks, Family, the "This week" section, the five-tab bar, the refund confirmation sheet.
- `packages/help-content`: topics for jobs and rewards, flex points, requests, payouts, the savings goal and the family review (needs review).
- `e2e/`: approvals, tasks and family specs. ADR 0012 (the ledger), 0013 (the economy rules).
