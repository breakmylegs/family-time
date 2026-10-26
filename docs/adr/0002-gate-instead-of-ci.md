# ADR 0002: The gate replaces CI

Status: accepted, 26 October 2026 (reuse report approved)

## Context

The brief asks for CI that runs everything, with nothing merged red. None of the other platforms has a GitHub Actions workflow; one had its CI switched off when the Actions spending limit was hit. The build laptop cannot run containers. The server can, but the laptop cannot reach it.

## Decision

1. `corepack pnpm gate` on the laptop: lint, dash check, secret scan, unit tests (PGlite), build, typecheck last. It stops at the first failure.
2. `scripts/update.sh` on the server builds the image's `test` stage and runs the same gate inside it with no network, then the real-Postgres tests in a throwaway Compose project (`deploy/compose.test.yml`). A failure stops the deploy before anything live changes.
3. The `update.sh` scenario tests (`scripts/test/verify-deploy.sh`) run in the image's gate every deploy. On the laptop they run only with `corepack pnpm gate:full`, because every process start costs seconds there and the run takes about an hour.

## Consequences

- "Nothing merges red" means: the laptop gate passes before every commit, and a deploy cannot go live unless the in-image gate passes.
- Tests that need real infrastructure (Postgres now; AdGuard in Phase 2; Besu in Phase 5) run only on the server. Name them `*.pg.test.ts` (and similar) so the laptop run excludes them, and make them refuse to run, not skip, when their database is missing.
- The owner pastes the output of each server run; that output is the evidence for a phase's exit criteria.
