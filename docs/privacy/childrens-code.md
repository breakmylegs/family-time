# Children's Code self-assessment

Family time against the ICO's Age appropriate design code (the Children's Code), standard by standard. Written 14 November 2026 for version 0.12.0. It is a self-assessment for the owner to review, not legal advice.

## Does the code apply?

V1 is one family running Family time on its own server for its own children. Processing for purely personal or household purposes is outside UK GDPR, so the code probably does not apply to V1 in law. We follow it anyway, because V2 is a public release and every decision must work for any household. Before V2, take advice on who the controller is when a family installs the software themselves, and whether the code applies to the people who publish it.

## The 15 standards

| # | Standard | Where Family time stands | Evidence in the build |
|---|---|---|---|
| 1 | Best interests of the child | Met. The design comes from the research on what helps children: praise not prizes, rules with reasons, no loss-framed mechanics | `docs/research/03-motivation.md`, CLAUDE.md rules that never bend |
| 2 | Data protection impact assessment | Template written; the owner fills it in for their household, and V2 needs its own | `docs/privacy/dpia-template.md` |
| 3 | Age appropriate application | Met for ages 5 to 13; 14 and over is partly met. Age bands shape the setup checklist. Teen self-management mode is V2 | `apps/api/src/family/extras.ts` (checklist), docs/plans/phase-11.md |
| 4 | Transparency | Met. The kiosk's What Mum and Dad can see lists, in a child's words, what parents can and can't see. It changes whenever the parent app does | `apps/kiosk/src/screens/ParentsSee.tsx` |
| 5 | Detrimental use of data | Met. No points deductions, punishments, sibling leaderboards, loss-framed streaks or system-generated variable rewards. Screen time is never taken away as a sanction | ADR 0013, CLAUDE.md |
| 6 | Policies and community standards | Met. What the kiosk says it does is what it does; there is no community or content from other users | ADR 0015 |
| 7 | Default settings | Met. AI is off by default. Optional features (savings goal, bonus, family challenge) come on only with the pilot phase the parents choose. The kiosk holds nothing until paired | ADR 0016, `packages/domain` features |
| 8 | Data minimisation | Met. Usage is counted per minute per app, never page by page. What the child writes is short and kept for a set time; a question about a rule is kept until it is answered, then 13 months. Every table has a retention rule or is needed for the ledger | `packages/db/src/retention.ts`, `docs/export.md` |
| 9 | Data sharing | Met. Nothing leaves the household's server unless the owner turns on cloud AI, and even then children's own words are never sent. Push alerts pass through the browser's push service and carry a first name, a job title or an app name, never what a child typed | ADR 0016, ADR 0011 |
| 10 | Geolocation | Met. Family time collects no location | n/a |
| 11 | Parental controls | Met. The child sees that parents can see their screen time, on the kiosk at all times, and can ask about any rule | Kiosk What Mum and Dad can see, Me, Ask about a rule |
| 12 | Profiling | Met. No profiling, no recommendations, no AI that talks to the child. AI only suggests to parents, and every suggestion waits for a parent | ADR 0016 |
| 13 | Nudge techniques | Met. No countdowns, no streaks, no variable rewards, no autoplay-style continuations. Stopping points end a session at a natural break | ADR 0013, stopping points (Phase 9) |
| 14 | Connected toys and devices | Partly applies. The kiosk tablet shows only the child's own page, can lock with a PIN for each child (Me, where a child writes their own things, needs one whenever more than one child uses the kiosk), and forgets the unlock when put down | ADR 0015, kiosk PINs |
| 15 | Online tools | Met. Parents can download everything Family time holds as one file. The owner can remove a child and, with `child-remove --erase`, delete what they wrote and the parents' notes about them; the points history and audit log stay as the family's record | `docs/export.md`, People |

## Gaps to close before V2

- Teen mode (standard 3): a summary-only parent view for 14 and over, chosen with the teenager.
- A child-facing privacy notice in the kiosk itself, beyond What Mum and Dad can see, written with children.
- Erasure from the app itself, not only the server's command line, and a way for a child to ask for it through a parent.
- Legal advice on the controller question above.
