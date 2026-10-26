# ADR 0006: A `packages/db` package for the schema and migrations

Status: accepted, 26 October 2026 (Phase 0 plan approved)

## Decision

The Drizzle schema, the generated migrations, the migrate runner and the PGlite test helper live in `packages/db`. This package is not in the brief's Part 17 layout.

## Why

The api and the worker both need the schema. Without a package, the schema would sit in `apps/api` and the worker would import from an app.

## Consequences

- New tables go in `packages/db/src/schema.ts`; `corepack pnpm --filter @family-time/db generate` writes the migration.
- `@family-time/db/testing` is for tests only. PGlite is a dev dependency and is not in the runtime image.
- A hook blocks edits to committed migrations.
