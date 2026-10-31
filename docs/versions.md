# Pinned versions

Every version is pinned exactly. Checked on the registry on 26 October 2026 unless a row says otherwise. Upgrade one row at a time, with the gate green, and update this file in the same commit.

## Runtime and images

| What | Version | Notes |
|---|---|---|
| Node.js | 24.15.0 | `.node-version`, `engines`, and the base image |
| Base image | `node:24.15.0-trixie-slim` | Official, publishes linux/amd64 and linux/arm64 |
| PostgreSQL | `postgres:18.6-trixie` | Data under `/var/lib/postgresql` (Postgres 18 layout) |
| Besu | `hyperledger/besu:26.10.2` | Newest 26.10 on 31 Oct 2026, multi-arch (amd64 and arm64) on Docker Hub. Only with the `ledger-besu` profile and in the test project |
| Foundry | v1.8.7 | Release tarball in the image's `contracts` stage, checked by SHA-256 (amd64 `ba470eb7…25bcf`, arm64 `6f0e5697…18534`, full values in the Dockerfile). Never on the laptop |
| Solidity | 0.8.38 | `contracts/foundry.toml`, EVM version Cancun |
| forge-std | v1.17.0, commit `f3dae6e6ee381f25eb6a246f7da9b85c91a68219` | Fetched by commit in the `contracts` stage |
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
| viem | 2.57.13 | ledger | yes (Part 17). Phase 5: the Besu signer, indexer and deploy |
| preact | 10.29.8 | kiosk | yes (Part 17). Phase 6. 11.x is out, but an old Fire WebView is the wrong place for a new major (reuse report) |
| @openzeppelin/contracts | 5.6.1 | contracts | yes (Part 17). Phase 5: Solidity sources only, compiled in the image |
| ai | 7.0.159 | ai | yes (Part 17). Phase 7: the gateway, and MockLanguageModelV4 for tests |
| @ai-sdk/anthropic | 4.0.94 | ai | yes (Part 17). Phase 7 |
| @ai-sdk/openai | 4.0.106 | ai | yes (Part 17). Phase 7 |
| @ai-sdk/google | 4.0.109 | ai | yes (Part 17). Phase 7. Paid-plan keys only |
| @ai-sdk/mistral | 4.0.77 | ai | yes (Part 17). Phase 7 |
| @ai-sdk/amazon-bedrock | 5.0.130 | ai | yes (Part 17). Phase 7. Session credentials only |
| @ai-sdk/openai-compatible | 3.0.82 | ai | yes (Part 17). Phase 7. For Ollama |
| @ai-sdk/mcp | 2.0.88 | ai | yes (Part 17). Phase 7. The weather for job ideas |
| @modelcontextprotocol/server | 2.4.0 | api | yes (Part 17). Phase 7. The MCP server at /mcp, protocol 2026-07-28 |
| @modelcontextprotocol/client | 2.4.0 | api (dev) | yes (Part 17). Phase 7. Drives /mcp in the tests |

## Checked for later phases, not installed yet

| Package | Version on 26 Oct 2026 | Phase |
|---|---|---|
| vite-plugin-pwa | 2.0.0 (supports Vite 8). Not used: a hand-written service worker is a few dozen lines (Phase 3 plan, decision 7) | 3 |
| openid-client | 6.8.8 | when owner OIDC is switched on (deferred from Phase 1) |


## Tooling

| Tool | Version | Notes |
|---|---|---|
| Emil Kowalski skills | `emilkowalski/skills`, hashes in `skills-lock.json` | Installed 26 Oct 2026 with `npx skills@latest add emilkowalski/skills -a claude-code -s '*' -y --copy` |
