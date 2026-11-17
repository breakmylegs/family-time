# ADR 0021: Privacy on a shared kiosk, erasure, and every family's words

Status: accepted, 15 November 2026 (Phase 12)

## Decision

- **Me needs the child's own PIN when siblings share.** With two or more active children in the household, the kiosk's Me routes (`/mine`, `/journal`, `/skills`, `/rule-asks`) and How was your week? (`/reflection`, wellbeing data) refuse a child without a kiosk PIN with `needs_pin`, and the kiosk explains it. One child needs no PIN. Home keeps today's behaviour (a PIN is optional), so a family that has not set PINs loses nothing it had. Children's Code standards 7 and 14: private by default where it matters.
- **Erasure is a command, not a button, for now.** `./scripts/ft.sh child-remove --child "Name" [--erase] [--yes]` shows what it will do, refuses while the child has devices, turns the profile off and clears the PIN; `--erase` deletes what the child wrote (things done, skills, questions and answers, ideas, reflections, photos, what they typed with a request) and the parents' notes about them (estimates, mood checks, how sessions ended, notes on jobs, age band, pronouns, checklist). The removal, the deletes and the audit entry share one transaction. The ledger and the audit log stay: they are the family's record, and the Besu chain cannot forget. Audit entries for the child's own text record no text (skill events carry none), and the erase entry holds counts only. It picks the household as child-add does and matches the name exactly. Children were only ever added from the command line, so removal sits beside it.
- **Every family's words.** A household setting (`kiosk_words`) holds what the children call their grown-ups; the kiosk's sentences use it, with the "or" form made from the last "and". The default stays "Mum and Dad", so the pilot family sees no change. Sentences were reworded so no verb has to agree with it ("Matched by Dad: an extra 50p", "Your questions about rules are only for Dad"). Owner only, letters and spaces, 40 characters.
- **Limits hold under concurrency.** The kiosk's limits (things done, skills, questions, ideas and open requests for time) are counted and written inside a transaction holding a per-child advisory lock (`pg_advisory_xact_lock(hashtext(child))`), which waits at most two seconds (`lock_timeout`) so a flood cannot hold the pool's connections. PGlite runs one query at a time, so no laptop test can show the lock working; a real-Postgres concurrency test is still to be written.

## Consequences

- The e2e demo now sets Ollie's PIN before using Me, and the demo reset clears PINs and the Phase 11 tables.
- Erasure from the app itself, and a way for a child to ask for it, remain for V2 (docs/privacy/childrens-code.md).
