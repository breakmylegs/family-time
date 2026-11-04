# Phase 8 plan: hardening and pilot readiness

Branch `phase-8`, from `phase-7`. Started straight after Phase 7, as the owner asked; the recommended option is taken at each choice and recorded here.

## Goal

Make the pilot safe to run for 16 weeks: backups that are proven by restoring them, a script that checks the running app, data kept only as long as it is needed, the household's data exportable, a System page for the owner, the pilot's measures on a dashboard, and an accessibility and security pass over everything.

## Exit criteria

1. On the server: `./scripts/backup.sh` makes an encrypted restic snapshot, and `./scripts/restore.sh` restores it into a scratch project from nothing and checks it (tables, row counts, the latest migration). Here: both scripts pass their shimmed scenarios.
2. On the server: `./scripts/verify.sh` is all green. Here: it passes its shimmed scenarios, and unreachable is never a pass.
3. The Impeccable audit of the parent app and the kiosk has no P0 or P1 findings.
4. Here: retention, export, the System page, the audit viewer, release notes, maintenance mode and the pilot dashboard are tested, and the gate passes.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Backups with restic on the host**, nightly by a systemd timer at 02:30. Postgres as a `pg_dump -Fc`, checked with `pg_restore --list` and a size floor before it counts; the AdGuard config volume; the Besu volume with Besu stopped for the copy (only with the `ledger-besu` profile). `secrets/` goes to a second restic repository with its own password, so one leaked password never opens both. Rotation (`--keep-daily 7 --keep-weekly 4 --keep-monthly 6`) only after `restic check` passes. Repositories and passwords are made by `init.sh`; the repository path defaults to `/var/backups/family-time` and can be any restic URL | Brief Part 15; reuse report 5 |
| 2 | **`restore.sh`** restores the latest (or a named) snapshot into a scratch Compose project with its own Postgres and no network, then checks tables, row counts and the latest migration, and removes the project. `--live` restores into the real stack for disaster recovery: it refuses unless the stack is stopped and the owner types the household name | "A backup never restored is not a backup" |
| 3 | **Backup results reach the app.** `backup.sh` records each run (`ft.sh backup-recorded`), so the System page shows the last backup. The worker pushes the owners an alert when the last run failed or no backup has succeeded for 36 hours | Brief Part 12: nightly backup failure is an alert |
| 4 | **`verify.sh`** probes the running stack from the host: `/healthz`, `/readyz` all checks, `/version` commit equals the deployed commit, the kiosk answers on the LAN address, and AdGuard admin (3000), Besu RPC (8545), Postgres (5432) and the worker do **not** answer from the host. Exit 0 all green, 1 a finding, 2 unreachable; unreachable is never a pass | Reuse report 11 |
| 5 | **Retention**, once a day in the worker, each period fixed in code and listed on the System page: sessions 30 days after they end, sign-in challenges and pairing codes 1 day after expiry, used or expired invites 90 days, OAuth codes 1 day and tokens 30 days after they end, AI proposals 90 days after they are decided, AI call records 13 months, help feedback 12 months, usage aggregates and session-end taps (the pilot's measures) 13 months, audit events 2 years. Photos stay at 30 days after the decision (Phase 6). Never pruned: ledger entries, the chain's records, people, rules. Each sweep that deletes anything audits its counts | Brief Part 15; reuse report 9 |
| 6 | **Audit retention through the trigger.** Migration `0011` replaces the append-only trigger function (no drop) so a DELETE is allowed only inside a transaction that sets `family_time.retention = 'on'` and only for rows over two years old. Updates and truncation stay refused | ADR 0007's append-only rule, with the narrow exception it promised |
| 7 | **Export**: `GET /api/export`, owner only, a documented JSON file of the household's data (`docs/export.md`), with a list of what it leaves out and why (passkeys, session and token hashes, sealed AI keys, photos) | Brief Part 15; reuse report 9 |
| 8 | **System page** (Settings, owner): version, commit, build time, schema, uptime, readiness checks, AdGuard and Besu status, reconciler health (last confirmed sync per device), last backup, pilot phase and the features it switches on, AI and MCP switches, retention periods, release notes from `CHANGELOG.md`, the audit log (filter by action, newer and older pages, CSV with the formula-injection guard), and Export | Brief Part 10's System page |
| 9 | **Maintenance mode**: `ft.sh maintenance on "message"` and `off`. While on, the api refuses changes (503 with the message) except sign-in, sign-out and Control, so a parent can always pause, the parent app shows a banner, and the reconciler keeps running so bedtime still applies. Audited | Brief Part 15 |
| 10 | **Pilot dashboard**: Family, Pilot measures (parents), week by week for the pilot so far: managed minutes per app, unused minutes converted, how many different jobs and ideas were done (offline variety), session-end taps by mood, minutes used during wind-down and bedtime, jobs approved. CSV export. The monthly wellbeing check is left out until the owner confirms the child scale's licence (brief Part 14) | Brief Part 14 |
| 11 | **Secrets per service**: the api no longer gets the VAPID private key; `init.sh` writes the public key to `secrets/vapid_public.txt`, which the api reads; each service lists only the secrets it needs. Besu dropping root is left until Besu is switched on for real (ADR 0017) | ADR 0011 and ADR 0014 follow-ups |
| 12 | **Release notes**: `CHANGELOG.md`, one plain line or two per version, parsed at boot from the copy in the image | Brief Part 15 |
| 13 | **Audits**: the Impeccable audit (accessibility, contrast, focus, motion, touch targets) over both apps with P0 and P1 fixed; the security reviewer over the whole repo; the copy reviewer over new screens | Phase 8 scope |
| 14 | **Left for V2, recorded**: the kiosk's optional PIN for siblings (the pilot has one child on the tablet), the monthly wellbeing check, pushed multi-arch images | Scope |

## Dependencies

None new in npm. `restic` is a host tool the owner installs on the server (`sudo apt install restic`), named in brief Part 15.

## Files

- `packages/db`: migration `0011` (audit retention trigger function, maintenance and backup settings need no table).
- `apps/worker`: `retention.ts`, backup freshness alert.
- `apps/api`: `system` routes (system, audit, export, release notes, maintenance), pilot metrics, CLI `maintenance` and `backup-recorded`.
- `apps/parent`: System screen, Pilot measures on Family, maintenance banner.
- `scripts/`: `backup.sh`, `restore.sh`, `verify.sh`, their shimmed tests, `init.sh` additions; `deploy/systemd` backup timer.
- `CHANGELOG.md`, `docs/export.md`, `docs/setup/backup.md`, ADR 0017.
