# ADR 0024: A longer test timeout for the db package

Status: proposed, 27 November 2026.

## Context

The pilot server is a Proxmox VM on an Intel i5-3337U (2 cores, 4 threads, 1.8 GHz), well under the brief's "4 vCPU on a normal machine". Its first three deploys of 0.15.1 (`45ee0c4`, 26 November) stopped at the in-image gate, so nothing went live. Each time only `@family-time/db` failed, and every failure the logs name is `Test timed out in 30000ms`:

| Run | VM | Failed |
|---|---|---|
| 21:21 | 2 vCPU, capped, host busy | 4 of 39: migrations 1 (file 31.6 s), control 1 (file 80.8 s), triggers 2 (file 136.7 s) |
| 21:53 | 4 vCPU, no cap, 5 GB | 4 timeouts: `migrations > applies every migration to an empty database`, `loadRules > reads services ...`, `last owner > cannot be deleted, demoted or deactivated by raw SQL`, `audit events > can be added but never changed, deleted or truncated` |
| 22:06 | 4 vCPU, no cap, 5 GB, host quiet | 3 timeouts: the first three above, `audit events` passed |

The tests are slow there, not wrong:

- No assertion failed in any run. The api, worker and ledger packages, which also use PGlite with a 30 s timeout, passed every time.
- Every test in these files calls `testDb()`, which starts a new in-memory PGlite and applies all 18 migrations. The failing ones are the first such test in each file, which also pays PGlite's cold start (WebAssembly compile and `initdb`). `applies every migration to an empty database` starts PGlite twice. Their bodies after `testDb()` are a few small queries.
- The other tests in the same files run the same `testDb()` and the same kind of assertions, and passed at about 15 to 20 s each (triggers: 9 tests in 136.7 s).
- Which tests fail changes with the load (`audit events` failed once in two identical runs). A wrong test fails the same way every time.

## Decision

`packages/db/vitest.config.ts`: `testTimeout` and `hookTimeout` from 30 s to 120 s. Nothing else changes: the same tests, assertions, workers (3) and gate. The other packages keep their timeouts, as they pass on that server.

120 s is about four times the slowest test seen. A test that really hangs still fails, only later.

## Consequences

- The deploy gate can pass on a slow server. On a normal machine nothing changes, as no test comes near 30 s.
- A db test that grows slow is noticed later. If the db suite itself becomes slow, share one migrated PGlite per file (a template database or `beforeAll` with a reset) instead of raising the timeout again.
- The real-Postgres tests (`vitest.pg.config.ts`) keep 30 s. They did not run on 26 November, because the gate stops first; if they time out on that server too, the same reasoning applies.

## Addendum, 28 November 2026: every PGlite package

Once db and domain passed (ADR 0025), the api package's PGlite tests hit the same 30 s limit on the same server. The 12:16 run had every api test passing except one stale expectation (fixed in `61dbf87`). The 12:48 run, with that fixed, timed out on five different api tests: `MCP > stops working the moment the owner removes the app`, two in `kiosk.test.ts`, two in `parent-app.test.ts`. No assertion failed, and the set of slow tests changed between runs, as it did for db. So `apps/api`, `apps/worker` and `packages/ledger`, which start PGlite and apply every migration in the same way, now have the same 120 s limits as db. Tests, assertions and workers are unchanged; the packages without PGlite keep theirs.
