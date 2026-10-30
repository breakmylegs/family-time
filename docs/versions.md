# Pinned versions

Every version is pinned exactly. Checked on the registry on 26 October 2026 unless a row says otherwise. Upgrade one row at a time, with the gate green, and update this file in the same commit.

## Runtime and images

| What | Version | Notes |
|---|---|---|
| Node.js | 24.15.0 | `.node-version`, `engines`, and the base image |
| Base image | `node:24.15.0-trixie-slim` | Official, publishes linux/amd64 and linux/arm64 |
| PostgreSQL | `postgres:18.6-trixie` | Data under `/var/lib/postgresql` (Postgres 18 layout) |
| AdGuard Home | `adguard/adguardhome:v0.107.79` | Newest stable 0.107 on 27 Oct 2026 (v0.108 and v1.0 are betas). Spec vendored in `packages/adguard-client/spec/` |
| pnpm | 10.34.9 | Through corepack. pnpm 12.15.0 is current, but did not start through corepack on the laptop. Revisit |

## Packages

| Package | Version | Where | In brief Part 17 |
|---|---|---|---|
| fastify | 5.12.7 | api | yes |
| zod | 4.6.7 | api, schemas | yes |
| drizzle-orm | 0.45.4 | db, api, worker | yes |
| drizzle-kit | 0.31.11 | db (dev) | approved, Phase 0 plan |
| pg | 8.23.1 | db, api, worker | approved, Phase 0 plan |
| pg-boss | 12.38.0 | worker | yes |
| @electric-sql/pglite | 0.5.11 | db, api, worker (dev) | approved, reuse report |
| turbo | 2.11.10 | root (dev) | yes |
| vitest | 5.0.5 | root (dev) | yes |
| typescript | 6.0.3 | root (dev) | approved. 7.0.2 is current, but typescript-eslint does not support it yet |
| eslint | 10.13.0 | root (dev) | approved |
| @eslint/js | 10.0.1 | root (dev) | approved |
| typescript-eslint | 8.72.0 | root (dev) | approved |
| globals | 17.13.0 | root (dev) | comes with the ESLint setup |
| @types/node | 24.19.2 | root (dev) | types only |
| @types/pg | 8.23.1 | db, api, worker (dev) | types only |
| @simplewebauthn/server | 14.0.3 | api | yes (Phase 1) |
| @simplewebauthn/browser | 14.0.0 | parent | yes (Phase 1) |
| react, react-dom | 19.3.1 | parent | yes (Phase 1) |
| vite | 8.3.5 | parent (dev) | yes (Phase 1) |
| @vitejs/plugin-react | 6.1.2 | parent (dev) | Vite's React plugin |
| tailwindcss, @tailwindcss/vite | 4.3.3 | parent (dev) | yes (Phase 1) |
| @types/react, @types/react-dom | 19.3.0 | parent (dev) | types only |
| @playwright/test | 1.64.1 | root (dev) | yes (Phase 1). Uses Chromium 1248 and WebKit 2370, already in the laptop's browser cache |
| fast-check | 4.10.2 | root (dev) | yes. Property tests in `packages/domain` |
| pg-boss | 12.38.0 | api | yes. The api queues a reconcile after each change |
| tsx | 4.23.15 | api (dev) | approved in Phase 0; runs `apps/api/dev/server.ts` |
| web-push | 3.6.7 | notify | yes (Part 17). Phase 3 |
| @types/web-push | 3.6.4 | notify (dev) | types only |
| @radix-ui/react-dialog | 1.3.1 | parent | asked and approved in the Phase 3 plan. Focus trap, Escape and focus return for the help panel and sheets |
| @fontsource/lora, @fontsource/poppins | 5.3.0 | parent | asked and approved in the Phase 3 plan. Self-hosted fonts, as the design README suggests |

## Checked for later phases, not installed yet

| Package | Version on 26 Oct 2026 | Phase |
|---|---|---|
| vite-plugin-pwa | 2.0.0 (supports Vite 8). Not used: a hand-written service worker is a few dozen lines (Phase 3 plan, decision 7) | 3 |
| preact | 10.29.8, not 11.0.2 (see reuse report) | 6 |
| openid-client | 6.8.8 | when owner OIDC is switched on (deferred from Phase 1) |
| viem | 2.57.11 | 5 |
| @openzeppelin/contracts | 5.6.1 | 5 |
| ai | 7.0.153 | 7 |
| @ai-sdk/mcp | 2.0.84 | 7 |
| @modelcontextprotocol/server, client | 2.4.0 | 7 |

The Besu image tag, including arm64, is checked in Phase 5.

## Tooling

| Tool | Version | Notes |
|---|---|---|
| Emil Kowalski skills | `emilkowalski/skills`, hashes in `skills-lock.json` | Installed 26 Oct 2026 with `npx skills@latest add emilkowalski/skills -a claude-code -s '*' -y --copy` |
