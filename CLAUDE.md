# Family time

Self-hosted family screen time and rewards platform. V1 is one family's 16-week pilot; V2 is a public release, so every decision must work for any household.

## Read first

- Brief: `docs/brief/build-prompt.md`. Order of authority when documents disagree: `docs/research/00-read-me-first.md`.
- Mock (visual source of truth): `docs/design/mock-screens.html`, captures in `docs/design/screenshots/`.
- Reuse report and how we build: `docs/reuse-report.md`. Current phase plan: `docs/plans/`.
- Phased build. Plan each phase, wait for approval, stop at the end and report (brief Part 23).

## Commands (Windows laptop, Node 24, pnpm through corepack)

```bash
corepack pnpm install
corepack pnpm gate          # lint, dashes, secrets, tests, build, typecheck last
corepack pnpm gate:full     # plus the update.sh scenarios (about an hour here, seconds on Linux)
corepack pnpm --filter @family-time/db generate   # new migration from packages/db/src/schema.ts
```

This laptop cannot run containers and cannot reach the servers. Containers are built and tested only on the server by `scripts/update.sh` (its test stage runs the whole gate with no network, then the real-Postgres tests). The owner runs it and pastes the output. Hand over only `./scripts/update.sh`, never raw `docker compose` commands.

## Rules that never bend

- Control precedence, highest first: Pause, parent override, schedule blocks, allowed time (grants, always-allowed), default. Overrides always expire.
- One control service is the only writer to AdGuard. Nothing else writes to it, including the parent app and AI.
- AI only proposes. Writes become Proposal rows a parent approves. No AI on the kiosk, none that talks to the child.
- The ledger sits behind `LedgerPort`. No points deductions, punishments, sibling leaderboards, loss-framed streaks or system-generated variable rewards.
- Never edit a committed migration; add a new one. Migrations are additive only (a test enforces it), because `update.sh` rolls back images, never the database.
- British English. 24-hour times, stored in UTC, shown in Europe/London.
- No em dashes or en dashes anywhere, code included. Use "to" for ranges. `scripts/check-dashes.mjs` fails the gate.
- Secrets live in `secrets/` (git-ignored, made by `scripts/init.sh`) and are read through `NAME_FILE`. Never gitleaks.
- Ask before: a dependency not in brief Part 17, anything touching the home network, router, DNS or other containers.

## Layout

`apps/api` Fastify, `apps/worker` pg-boss jobs, `packages/db` Drizzle schema and migrations (PGlite in tests), `packages/schemas` Zod, `deploy/` Compose, Caddy, systemd, `scripts/` gate, init, update, drill.

## Traps already hit here

- Long shell heredocs fail on this machine. Write files with the Write tool.
- Every process start costs seconds on this laptop. Batch work into one process.
- PGlite takes seconds to start the first time in a test file; tests have a 30 second timeout.
- `trustProxy` must stay a function of the hop count. A number is ignored on Fastify 5.12.
