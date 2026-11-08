# Phase 9 plan: completing the brief

Branch `phase-9`, from `phase-8`. A walk through the brief, part by part, against what is built found items no phase finished. The owner asked for every build item to be done, so this phase does them, recommended option at each choice.

## What the walk-through found

| # | Brief | Gap | This phase |
|---|---|---|---|
| 1 | Part 14, research feature list | The pilot's transitions phase (weeks 9 to 12) switches on three things nothing builds: natural stopping-point endings, the parents' own screen time card, a family challenge | Build all three, switched on by the transitions phase |
| 2 | Part 9, Settings | Devices and AdGuard clients, groups and policies, and schedules are set only from the command line | Owner screens for each, on the same commands the CLI uses |
| 3 | Part 12 | No alert when AdGuard is unhealthy, and no weekly review reminder | Both, to owners and parents |
| 4 | Part 15 | `/readyz` does not check AdGuard, or Besu when it is on | Both checks, each saying what it proves |
| 5 | Part 6 | Parental matching on the savings goal (a nice-to-have, left in Phase 4) | Optional matching percent, paid as the parent's own MONEY entry |
| 6 | Part 16 | No `ai-local` profile for Ollama | The profile, off by default, LAN-only, with a pinned image |
| 7 | ADR 0014 | Phase 5 security follow-ups: node permissioning, the admin key in `secrets/` | Account permissioning on the node; `init.sh` stops keeping the admin key once it has been used |
| 8 | Plans and ADRs | Notes still say "left for later" about things since done | Corrected |

Still not built, with reasons: the monthly wellbeing check (the child scale's licence is the owner's to confirm, and the pilot child is over 8, so the parent mood check does not apply); owner OIDC (`OWNER_SSO` is `none`); kiosk HTTPS on the LAN and router rules (the owner's network); on-chain contract changes from ADR 0014 (they need Foundry, which runs only in the image build; recorded for the next contract version).

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Stopping-point endings**: when a planned session or an Allow ends, the block waits a few minutes (household setting, default 5, 0 to turn off) so the child can reach a natural stopping point. Never past the start of bedtime. The kiosk says "Time to find a good place to stop" with no countdown; Control shows "Finishing up until 19:05". Grace minutes are not charged | Research section 6 and principle 5; countdown warnings are evaluated and not recommended |
| 2 | **Parents' own screen time card**: each parent enters an estimate of their own leisure screen time for the week on Family; Family shows the trend; the kiosk shows "Mum and Dad this week" when the transitions phase is on. Self-report only, never measured | Principle 7; SCREENS asked every family member to cut |
| 3 | **Family challenge**: one at a time, set by a parent with a title and how many times this week ("Screen-free tea, 5 times"). Parents tick it on Family and the child on the kiosk; progress is shared. No points, no streaks, nothing lost if missed | Research section 7: cooperative family goals help; loss-framed streaks harm |
| 4 | Settings editors are owner-only (`system.manage`), on the same commands as `ft.sh`, audited, and tested through the api | Brief Part 8 owner role |
| 5 | Matching: a percent on the goal (0 to 100); when a payout is recorded the match is a separate MONEY award "Matched by Mum and Dad", never a deduction | Brief Part 6; no punishment through the ledger |
