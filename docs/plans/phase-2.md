# Phase 2 plan: control engine and AdGuard

Branch `phase-2`. Approved to start on 27 October 2026, with my recommendations for the open questions. Nothing here touches your router or your devices' DNS. AdGuard runs in the stack, but nothing uses it until you point a device or the router at it, which is your step (`docs/setup/network.md`).

## Goal

The platform works out what each child's devices should be allowed to reach at any moment, and one service makes AdGuard match it, then checks that it did.

## Exit criteria

1. Here: property tests for the precedence order, expiry, time zones and the clock change. Reconciler tests against a fake AdGuard that behaves like the real API (whole-client replace, rules list). A test that every AdGuard call we make exists in the pinned v0.107.79 spec.
2. On the server, later: the same AdGuard contract tests against the real container, in `update.sh`'s test project. Then YouTube and Roblox block and unblock on the iPad within 60 seconds, with read-back confirmed.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The engine is pure TypeScript in `packages/domain`: given the time and the household's rules, it returns each child's state for each service, the reason in plain English, and when it next changes. Time zones use the platform's `Intl`, no library | Brief Part 4. Testable with a fake clock and fast-check |
| 2 | Open question: an Allow "until tomorrow" ends at the next bedtime unless the parent turns on "Through bedtime" | Protect sleep first. Your call, taken as recommended |
| 3 | Open question: "Count it in his weekly time" defaults to on | Extra time is a deliberate choice. Stored now, charged to the ledger in Phase 4 |
| 4 | The AdGuard client is written by hand for the dozen calls we use, and checked against the pinned spec (vendored as JSON) by a test, instead of generated | A generator is a new dependency for a dozen calls. The test gives the same protection: a call or field that is not in v0.107.79 fails the build |
| 5 | A fake AdGuard (an in-memory HTTP server with the real API's quirks) for the laptop. The same contract tests run against the real container on the server | The laptop cannot run containers |
| 6 | One AdGuard client per device, `use_global_blocked_services: false`. Built-in services go in `blocked_services`. Custom services are `$client` rules between `! family-time: begin` and `! family-time: end`. If those markers are missing, duplicated or out of order, the reconciler writes nothing and reports it | Never touch rules outside our markers, and never guess where they are |
| 7 | The reconciler is a pg-boss singleton every 60 seconds and after every change. Read the client, compute it, write the whole object, read back, compare. Three failed confirmations in a row mark the device "not confirmed" (the push to parents comes with Web Push in Phase 3) | Brief Part 5 |
| 8 | AdGuard in Compose on the internal network. DNS port 53 published on the server's LAN address only; `init.sh` detects it and records it in `deploy/.state/network.env`. The admin UI is never published | Brief Parts 5 and 16. Binding all addresses would clash with the server's own resolver |
| 9 | AdGuard's first-time setup, the global settings (TTLs, log retention) and the bypass rules are applied only by `./scripts/ft.sh adguard-setup`, which you run and which prints every change | The brief asks for your approval before the global settings change |
| 10 | Phase 2 setup is on the command line (`ft.sh child add`, `device add`, `services sync`, `block`, `allow`, `normal`). The Control and Settings screens are Phase 3, and use the same API | Keeps this phase about the engine and AdGuard |
| 11 | Usage and device health come from one job that reads AdGuard's query log every minute and stores per-minute counts per device and service, plus last seen. Raw log lines are never stored. A device silent for 30 minutes outside bedtime is marked quiet | Brief Part 5 and Level 3 data rules |

## Files

- `packages/domain`: time zone helpers, schedules, precedence engine, override durations, reasons, property tests.
- `packages/db`: migration `0003_control`: services, groups, policies, devices, schedules, overrides, grants, AdGuard sync status, usage minutes, device health.
- `packages/adguard-client`: client, rules-block parser, spec check, fake AdGuard, contract tests (`*.adguard.test.ts`, real container only).
- `apps/worker`: reconcile job, usage and health job.
- `apps/api`: `/api/status`, `/api/overrides`, `/api/devices/:id/discovery`; CLI commands above.
- `deploy/compose.yml` and `compose.test.yml`: AdGuard v0.107.79.
- `docs/setup/network.md`: the router checklist (DNS to AdGuard, block outbound DoT on 853) for you to do.
- ADRs 0009 (engine), 0010 (AdGuard ownership).
