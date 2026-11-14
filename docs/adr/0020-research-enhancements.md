# ADR 0020: Enhancements from the research

Status: accepted, 14 November 2026 (Phase 11)

## Decision

- The research's V1 must-haves, nice-to-haves, guardrails and metrics that phases 0 to 10 had not built are built now (docs/plans/phase-11.md): the platform setup checklist, the child asking about a rule, the parents' weekly estimate of unmanaged screen time, the offline activity journal, skills confirmed by a grown-up, the parents' monthly mood check, age bands, and a Children's Code self-assessment with a DPIA template (docs/privacy/).
- One additive migration (0016): five tables (`journal`, `skills`, `rule_asks`, `unmanaged_time`, `mood_checks`) and two columns on `people` (`age_band`, `setup_done`). Every new table is in the export and has a retention rule.
- Praise, never points. Nothing here calls `LedgerPort` or changes time, money or flex points. A skill is mastered only when a grown-up confirms it; the child never sees a count, a streak or a comparison.
- The checklist is code, not data: items and their words live in `apps/api/src/family/extras.ts`, chosen by age band, and only the ticks are stored. Family time cannot check another app's settings, so it never claims to.
- Who sees what. Each child sees only their own page on the kiosk (Me). Carers see and praise things done and skills; questions about rules, the estimates and the mood check are for parents (`rules.edit`). Questions show on Approvals as their own kind and are left out of what AI and connected apps receive (`get_pending_approvals` and `approvalsFor` never include them), because they are the child's own words.
- Kiosk limits stop a flood without punishing: ten things done a day, twelve skills, three questions waiting at once. Each refusal says what to do instead.
- The kiosk's What Mum and Dad can see lists the new things parents see, so it stays true (Children's Code standard 11).
- The mood check is labelled as a simple parent check, not a validated scale; the child wellbeing scale waits until its licence is confirmed.

## Consequences

- The pilot measures gain a column for the estimate, a monthly mood list, and things done in offline variety. The measures' week is now the household's own date rather than the UTC date of its start, which differed in summer.
- Not built, with reasons, in the plan: co-play windows (an Allow can already not count against the week), teen self-management and differential pricing (V2).
- Erasing everything about a child is still a gap (removing a child turns the profile off). It is listed in docs/privacy/childrens-code.md for V2.
