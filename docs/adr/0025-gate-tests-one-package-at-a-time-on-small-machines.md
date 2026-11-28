# ADR 0025: The gate tests one package at a time on small machines

Status: proposed, 28 November 2026.

## Context

With ADR 0024 in place the db tests no longer time out on the pilot server (a VM on an Intel i5-3337U, boosted to 4 vCPU for a deploy). The next two deploys of `597a74b` on 28 November stopped at the in-image gate on a different package:

| Run (UTC) | Host | Failed |
|---|---|---|
| 11:54 | busy (other jobs on the host) | 4 timeouts in `@family-time/domain`, `test/properties.test.ts` |
| 12:09 | quiet | the same 4 timeouts |

The four are property tests (`precedence > with no pause, the newest live block always blocks`, three under `expiry and until`), each hitting the domain package's 60 s limit. No assertion failed. On 26 November, on the same server and with the same domain code, these tests passed: the db tests then failed after 30 s and stopped competing for the CPU. With the db tests now allowed to run for up to 120 s, both packages run side by side for longer.

The gate runs `turbo run test --concurrency=2`, and each package's vitest runs up to 3 workers. That is up to 6 busy workers on 4 vCPU, and the CPU-heavy property tests are the ones that lose. They are slow there, not wrong: they pass when they get the CPU.

## Decision

`scripts/gate.mjs` tests the packages one after another (`--concurrency=1`) when the machine has fewer than 8 CPUs (`os.availableParallelism()`), and two at once as before on larger machines. `GATE_TEST_CONCURRENCY` overrides it. Tests, assertions, timeouts and workers per package are unchanged.

## Consequences

- The test step takes longer on a small server (roughly the sum of the packages rather than the longest pair), but each package gets the whole machine, so no test needs a longer timeout.
- Laptops and CI with 8 or more CPUs behave exactly as before.
- If a package's own tests ever time out with the machine to themselves, that package needs its own fix (as db had in ADR 0024), not more concurrency changes.
