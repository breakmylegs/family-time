# Phase 0 plan: foundations

Branch `phase-0`. Nothing here touches your network, router, DNS or any other container. Nothing outside this repo changes, except installing Emil Kowalski's skills into the project (approved with the report).

## Goal

A monorepo that builds, tests and deploys an empty but real stack. The api answers `/healthz`, `/readyz` and `/version`. The worker runs a heartbeat. Postgres is migrated. `update.sh` deploys on the VM and rolls back on a forced failure. Claude Code is set up for the phases that follow.

No product features. No accounts (Phase 1), no AdGuard (Phase 2).

## Exit criteria (as agreed in the reuse report)

1. `pnpm gate` passes on this laptop: lint, dash check, secret scan, unit tests (PGlite for the database), build, then typecheck last.
2. The `update.sh` scenario tests pass here with fake `docker` and `git` commands, including lock refused, failed test stage, failed migration, failed readiness with rollback, and Ctrl-C.
3. On the VM: `./scripts/init.sh` then `./scripts/update.sh` bring the stack up healthy, and `./scripts/drill-rollback.sh` shows an automatic rollback to the previous commit. You run these and paste me the output.

## Decisions taken in this phase

| # | Decision | Why |
|---|---|---|
| 1 | pnpm 10 through corepack (`packageManager: pnpm@10.34.9`), Node 24 | pnpm 12 did not start through corepack here. pnpm 10 is what TripBoard runs. Recorded in `docs/versions.md` to revisit |
| 2 | TypeScript 6.0.x, not 7 | typescript-eslint does not support TypeScript 7 yet (hit in TripBoard) |
| 3 | ESLint 10 with typescript-eslint 8 for lint | The brief says lint without naming a tool. This is the estate's choice |
| 4 | New package `packages/db`: Drizzle schema, migrations, migrate runner | Part 17 has no home for the schema, and both api and worker need it. Without it, the schema would sit in `apps/api` and the worker would import from an app |
| 5 | One image for api and worker, built once | One build, one tag. Proscenia's three-services-one-tag build deadlocked BuildKit |
| 6 | The api serves the parent and kiosk static builds. The kiosk is on a second listener bound to the LAN address only | One origin for cookies and SSE; nothing to gain from static containers at home. ADR |
| 7 | Images tagged `family-time:<commit>`, previous commit kept in `deploy/.state/previous`. Automatic rollback swaps images only. Migrations are additive only, so the previous image runs on the new schema | The brief wants commit tags and automatic rollback; the estate's lesson is never to roll a database back automatically. ADR |
| 8 | The gate replaces CI: `pnpm gate` here, and the same gate in the image's `test` stage with no network, run by `update.sh` before anything live changes | Approved in the reuse report. ADR |
| 9 | Secrets are files under `secrets/` (mode 0600, git-ignored) created by `init.sh` and mounted as Docker secrets. Code reads `NAME_FILE`; an unreadable file is an error | Reckoner and ClauseWorks pattern. No setting has to live in `.env` |
| 10 | Postgres 18 on the internal network only, no published port | Part 16 |

## Dependencies added in this phase

Part 17 already lists Fastify, Zod, Drizzle, pg-boss, Turborepo, Vitest and fast-check. The ones below are not in Part 17. PGlite you approved; the rest I am asking for now.

| Package | Why |
|---|---|
| `typescript`, `tsx` | Compile and run TypeScript |
| `eslint`, `typescript-eslint`, `@eslint/js` | Lint |
| `pg` | The Postgres driver Drizzle and pg-boss use |
| `drizzle-kit` | Generates migrations (Drizzle's own tool) |
| `@electric-sql/pglite` | Postgres in WebAssembly for tests here (approved) |

Exact versions go in `docs/versions.md` when installed.

## Files

### Repo root

| File | What |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `.node-version` | Workspace, task graph, Node 24 pin |
| `tsconfig.base.json`, `eslint.config.js` | Shared TypeScript and lint settings |
| `CLAUDE.md` | Short project rules: commands, precedence order, single AdGuard writer, AI proposes only, ledger behind the port, British English, no dashes, never edit applied migrations, where the research and mock live, build and test split |
| `CHANGELOG.md` | Release notes, read by the app later |
| `Dockerfile`, `.dockerignore` | Stages: deps, build, `test` (runs the gate, no network), runtime (non-root, build stamp) |

### apps/api

| File | What |
|---|---|
| `src/server.ts` | Fastify factory. `trustProxy` as a hop-count function, JSON-only body parser at the root, pino logger with redaction, health routes registered before any guard |
| `src/health.ts` | `/healthz` touches nothing. `/readyz` checks Postgres and the worker heartbeat with a timeout each, 503 when not ready. `/version` returns commit, build time and schema version |
| `src/build.ts` | Reads the build stamp once at boot |
| `src/config.ts` | Reads settings and `*_FILE` secrets |
| `src/index.ts` | Entry point |
| `test/*.test.ts` | Health, readiness with Postgres down, version, the log shape, health probes at debug |

### apps/worker

| File | What |
|---|---|
| `src/index.ts` | pg-boss start, a heartbeat job every 30 seconds |
| `test/heartbeat.test.ts` | Heartbeat write and freshness rule |

### packages

| File | What |
|---|---|
| `packages/db/src/schema.ts` | Phase 0 tables only: `worker_heartbeat` |
| `packages/db/migrations/0000_*.sql` | First migration, generated |
| `packages/db/src/migrate.ts` | Migrate runner used by the one-shot `migrate` service |
| `packages/db/test/migrations.test.ts` | Every migration applies on PGlite, and is additive only (no `DROP`, no `ALTER ... TYPE`, no `NOT NULL` without a default) |
| `packages/schemas/src/health.ts` | Zod shapes for the three health responses |
| `packages/domain`, `packages/tokens` and the other Part 17 packages | Created in the phase that first needs them, not as empty folders now |

### deploy

| File | What |
|---|---|
| `deploy/compose.yml` | api, worker, `migrate` (one-shot), postgres. Networks: `internal` plus external `proxy_net`. Memory limits sized for a Pi 5 with 8 GB, restart policies, healthchecks, `cap_drop: ALL`, `no-new-privileges`, secrets, log rotation. Profiles `ledger-besu` and `ai-local` reserved |
| `deploy/compose.test.yml` | Throwaway project the `update.sh` test step uses for the real-Postgres tests |
| `deploy/caddy/family-time.caddy` | Site block for the parent app, `flush_interval -1` for SSE (used from Phase 3). Caddy terminates TLS itself |
| `deploy/systemd/family-time.service` | Starts the stack at boot |

### scripts

| File | What |
|---|---|
| `scripts/gate.mjs` | The whole check, stops at the first failure, typecheck last. Same script runs in the image's `test` stage |
| `scripts/check-dashes.mjs` | Fails on an em or en dash in copy, docs and help content. Refuses if it finds fewer files than a floor, so an empty search cannot pass |
| `scripts/check-secrets.mjs` | Small readable secret scan of tracked files (no gitleaks) |
| `scripts/init.sh` | Creates `secrets/` (Postgres password, session key, master key) with mode 0600. Asks nothing. Safe to run twice: never overwrites a secret. Later phases add VAPID, ledger keys and the owner invite |
| `scripts/update.sh`, `scripts/lib/deploy-lib.sh` | Phases: preflight, pull, re-exec if the script changed, build, test stage, real-Postgres tests, snapshot (`pg_dump` with a size floor), migrate, start, health gate, version check, finish or roll back. Distinct exit codes. `mkdir` lock with owner file. `EXIT` trap plus `INT` and `TERM` traps that exit. Logs to a file |
| `scripts/drill-rollback.sh` | One-off: deploys a build whose readiness always fails, checks `update.sh` rolls back to the previous commit and the site still answers |
| `scripts/test/verify-deploy.sh`, `scripts/test/shims/` | Scenario tests for `update.sh` with fake `docker` and `git` |

### Claude Code setup

| File | What |
|---|---|
| `.claude/settings.json` | Hooks below |
| `.claude/hooks/after-edit.mjs` | Typecheck and affected tests for the touched package. Batched, one call, so it stays fast on Windows |
| `.claude/hooks/guard-migrations.mjs` | Blocks an edit to any migration file already committed |
| `.claude/hooks/dash-check.mjs` | Dash check on edited copy, docs and help files |
| `.claude/hooks/forge.mjs` | `forge fmt` and `forge test` when `contracts/` changes (no-op until Phase 5) |
| `.claude/agents/contracts-reviewer.md`, `security-reviewer.md`, `ux-copy-reviewer.md`, `help-content-reviewer.md` | The four subagents in Part 20 |
| `.claude/skills/add-service/SKILL.md`, `.claude/skills/add-help-topic/SKILL.md` | Project skills. Written now as outlines and finished in Phases 2 and 3 when their code exists |
| `.claude/skills/` (Emil Kowalski) | `npx skills@latest add emilkowalski/skills` |

### docs

| File | What |
|---|---|
| `docs/versions.md` | Every pinned version, with the date checked |
| `docs/adr/0001` to `0006` | Stack and tooling; build and test on the server instead of CI; api serves the static builds; commit tags and image-only rollback; secrets as files; `packages/db` |
| `docs/setup/server.md` | For you: the Proxmox VM, Docker, the HTTPS token clone, `init.sh`, `update.sh`, the rollback drill, the systemd unit |

## What you will run on the VM at the end

```bash
git clone https://github.com/<owner>/family-time.git /opt/family-time
```

```bash
cd /opt/family-time && ./scripts/init.sh && ./scripts/update.sh
```

```bash
cd /opt/family-time && ./scripts/drill-rollback.sh
```

The exact lines, with the repo name, go in `docs/setup/server.md`.

## Not in this phase

`verify.sh`, backups and restore (Phase 8). Health watcher (Phase 8). AdGuard, Besu and Ollama services (their phases). Any UI.

## Waiting on you before I start

1. Approval of this plan.
2. The new dependencies in the table above, apart from PGlite, which you have already approved.
3. The GitHub repo name, so the VM can clone it. I can build Phase 0 without it, but cannot hand you the VM commands.
