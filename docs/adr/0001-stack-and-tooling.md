# ADR 0001: Stack and tooling for Phase 0

Status: accepted, 26 October 2026 (Phase 0 plan approved)

## Decision

- Node 24, pnpm workspaces through corepack (pnpm 10), Turborepo.
- TypeScript 6, ESM throughout (`"type": "module"`, NodeNext resolution).
- ESLint 10 with typescript-eslint 8 for lint.
- Vitest for tests. PGlite for anything that touches Postgres on the laptop.
- Exact versions only, recorded in `docs/versions.md`.

## Why

The brief fixes the runtime and frameworks (Part 17). It leaves the lint tool and the TypeScript version open. ESLint with typescript-eslint is what the other platforms use. TypeScript 7 breaks typescript-eslint today, and pnpm 12 did not start through corepack on the laptop, so both stay one major back until that changes.

## Consequences

- Workspace packages build to `dist/` and are imported through `exports`, so tests and typecheck build dependencies first (`dependsOn: ["^build"]`).
- Revisit pnpm 12 and TypeScript 7 at the start of each phase.
