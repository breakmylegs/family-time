# Family Screen Time and Rewards Platform V1 Research Report (October 2026)

## Status of this document

Current for the technology stack, AdGuard Home, the ledger, UX, AI and MCP. Two areas were later refined.

- **Economics.** `03-motivation.md` changes how points work. Screen time is an agreed weekly allowance rather than mainly earned from tasks, and chores earn money or flex points by default. Where the feature list below says the child spends earned points on screen time, read it through `03-motivation.md` and `docs/brief/build-prompt.md` Part 6.
- **Kiosk copy.** DNS cannot see the end of a video. The kiosk says "New videos won't start after 19:00. The one you're watching can finish."

Versions below were current in late October 2026. Verify each on the registry at scaffold time.

---

Your architecture is sound and should go ahead, with four changes. Target Vercel AI SDK 7 rather than 6, build on MCP TypeScript SDK v2 for the 2026-07-28 specification, keep Tailwind v4 out of the Fire tablet kiosk unless the tablet runs Fire OS 7 with a recent Amazon WebView, and do not reward activities your son already enjoys (trampoline, LEGO), because the research says that is where token economies backfire.

## TL;DR

- **Stack and enforcement are validated.** Fastify 5, Drizzle, pg-boss, SSE, Zod 4, React 19 PWA, a Preact kiosk and AdGuard Home v0.107.79 (pinned, not the new 1.0 beta) give a single-writer control loop that is practical on a Raspberry Pi 5. DNS blocking works for YouTube and Roblox but only gates new connections, so the platform must say "takes up to a minute" and treat Apple Screen Time as the hard backstop.
- **Blockchain is a learning layer, not the system of record for safety.** Besu 26.10 single-validator QBFT with an immutable OpenZeppelin v5 ERC-1155 contract (soulbound via `_update`), a serialised backend signer and a Postgres read model is the right design. Skip Blockscout in V1 because it is heavy and needs archive plus trace APIs.
- **Biggest product risk is motivational, not technical.** Deci, Koestner and Ryan's 128-study meta-analysis in Psychological Bulletin (1999) found that engagement-, completion- and performance-contingent rewards significantly undermined free-choice intrinsic motivation, more so in children. Pay for chores and effortful tasks, use praise and surprise bonuses for things he already loves, and make AI strictly propose-only with the paid tiers of cloud providers (Gemini's free tier is barred for UK-facing use).

## Key Findings

| Area | Finding | Implication for V1 |
|---|---|---|
| AI SDK | AI SDK 7.0 shipped on 25 June 2026, is ESM-only and needs Node.js 22+. v7 replaced v6's per-tool `needsApproval` with `toolApproval` | Start on v7 with Node.js 24 LTS |
| MCP | The 2026-07-28 specification removed the initialise handshake and `Mcp-Session-Id`. TypeScript SDK v2 (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`) is the stable line implementing it | Use `createMcpHandler`, signed `requestState`, and Multi Round-Trip Requests for write confirmations |
| AdGuard Home | Stable is v0.107.79 (18 August 2026). v1.0.0-b.1 (5 October 2026) is a beta with a redesigned interface | Pin 0.107.79. Run contract tests against the API before any 1.0 upgrade |
| Besu | Latest is 26.10.0 (16 October 2026). The repository moved to besu-eth/besu. 26.7.1 fixed five vulnerabilities | Pin a 26.x tag that publishes linux/arm64 |
| Tailwind v4 | Requires Safari 16.4+, Chrome 111+, Firefox 128+ and cannot be transpiled down | Fine for the iPhone PWA. Risky for Fire OS WebViews |
| Fire OS WebView | Fire OS 7.3.3.1 on 11th-gen Fire HD 10 ships Amazon WebView v120. Older Fire OS WebViews are reported at Blink 58 or 59 | Use a Fire OS 7 tablet updated to the latest build. Treat Fire OS 5 as unsupported |
| Motivation research | Expected tangible rewards reduced free-choice motivation. Positive feedback did not undermine it | Reward chores, not hobbies. Praise is a feature |
| Gemini API | Unpaid quota content is used to improve Google products with possible human review, and Google's terms allow only Paid Services for users in the UK, EEA and Switzerland | Paid tier only, enforced in the provider registry |

## 1. Recommended V1 Tech Stack

| Layer | Choice | Version (late October 2026) | Rationale |
|---|---|---|---|
| Runtime | Node.js | 24 LTS | Node 22 reached end of maintenance on 30 April 2026, and AI SDK 7 and Vitest 5 need 22+ |
| Backend framework | Fastify | 5.12.7 | Mature plugin ecosystem, schema-first routes, good SSE plugins. v6 is still alpha. Hono is a fine alternative |
| Validation | Zod | 4.6.7 | One schema package shared by API, PWA, kiosk, MCP tools and AI structured output |
| ORM and migrations | Drizzle ORM plus drizzle-kit | 0.45.4 stable, 1.0 at RC | SQL-first migrations committed from the first commit. Upgrade to 1.0 when GA |
| Database | PostgreSQL | 18.6 | Pin 18 |
| Jobs | pg-boss | Latest at scaffold time | No Redis container, transactional enqueue with domain writes, singleton jobs for the reconciler and serialised chain signer |
| Real-time | Server-Sent Events | Native `EventSource` | One-way server push is all you need, works through Caddy, supported on old Chromium WebViews. Add 30-second polling fallback |
| Parent PWA | React 19 plus Vite 8 plus Tailwind 4.3 plus shadcn/ui on Radix | Verify at scaffold | Best component ecosystem and accessibility primitives |
| PWA tooling | vite-plugin-pwa (injectManifest mode) | Verify Vite 8 support | Custom service worker for push handling, otherwise hand-write a small service worker |
| Web Push | web-push (npm) with VAPID, plus Declarative Web Push payloads | Latest | Standards push via APNs, no Apple Developer account needed |
| Kiosk | Preact plus Vite, plain CSS custom properties | Preact 10.x | Small bundle for a low-end tablet |
| Passkeys | @simplewebauthn/server and /browser | Latest | De facto TypeScript WebAuthn library |
| OIDC | openid-client | Latest | Certified client for optional Authentik login |
| Ledger | Hyperledger Besu, OpenZeppelin Contracts, Foundry, viem | Besu 26.10.0, OpenZeppelin 5.x, Foundry 1.8.x, viem 2.x | See section 3 |
| AI | AI SDK 7 plus @ai-sdk/mcp | ai 7.0.x, pin exact | v7 ships patch releases very frequently |
| MCP | @modelcontextprotocol/server and /client | 2.x | Implements 2026-07-28 |
| Monorepo | pnpm workspaces plus Turborepo | Latest | Cached task graph |
| Testing | Vitest 5, Playwright 1.64, forge test | Latest | Playwright covers WebKit for the iPhone PWA and Chromium for the kiosk |
| Proxy | Caddy | Existing | SSE needs `flush_interval -1` |
| DNS | AdGuard Home | v0.107.79 | See section 2 |

All listed images publish linux/arm64 builds for Raspberry Pi 5. Check per tag, because some Besu tags show only an amd64 digest. Build your own images multi-arch from day one with `docker buildx`.

## 2. AdGuard Home Integration Design

**Version and API.** Pin `adguard/adguardhome:v0.107.79`. The API lives under `/control/` and is described in `openapi/openapi.yaml` in the repository, with HTTP Basic authentication. Create a dedicated AdGuard user for the control service and restrict the admin port to the Docker network.

| Endpoint | Use |
|---|---|
| `GET /control/clients`, `POST /control/clients/add`, `POST /control/clients/update`, `POST /control/clients/delete` | Persistent client per device with `use_global_blocked_services: false`, `blocked_services`, `blocked_services_schedule` |
| `POST /control/clients/search` | Find clients by IP, CIDR, MAC or ClientID |
| `GET /control/blocked_services/all` | Service catalogue including groups, seeds the default groups |
| `GET /control/filtering/status`, `POST /control/filtering/set_rules` | Custom rules with `$client` for services not in the built-in catalogue |
| `GET /control/querylog` | Discovery helper and usage estimates |
| `GET /control/stats` | Per-client counts for the weekly summary |
| `GET /control/dhcp/status` and related | V2 DHCP takeover path |

Upgrade discipline. v0.107.74 changed the configuration schema from 33 to 34, and v0.107.77 fixed CVE-2026-41448. Never upgrade without the contract test suite passing.

**Control service design.**

- Desired state is computed in Postgres per device per service from precedence.
- The reconciler is a pg-boss singleton job every 60 seconds and after every change. It GETs the client, diffs, POSTs `clients/update` with the full object (the API replaces the whole client), then GETs again and compares. Mismatch raises a "not confirmed" status on the parent card and a push after three failures.
- Built-in services go in `blocked_services`. Custom services become a managed block of rules delimited by marker comments, for example `||example.com^$client='son-ipad'`. The service owns only lines between its markers.
- One AdGuard client per physical device, mapped to children in our own schema.
- `blocked_response_ttl` 10 and `cache_ttl_max` 60.
- When a parent blocks during a paid grant, store remaining minutes, mark the grant paused and resume on "Back to normal". Offer refund as an explicit parent action.

**Effectiveness on the iPad.** For Roblox the commonly cited set is `roblox.com`, `rbxcdn.com`, `rbxinfra.com` and `robloxlabs.com`, and blocking `roblox.com` alone prevents login and game loading. New connections fail within one cache cycle. A running Roblox session or a buffered YouTube video carries on until the app reconnects. Screen Time limits stay on as the backstop.

**Bypass mitigation checklist.**

- [ ] NXDOMAIN for iCloud Private Relay with `||mask.icloud.com^$dnsrewrite=NXDOMAIN` and the same for `mask-h2.icloud.com`. iOS then shows "Private Relay is turned off for this network"
- [ ] NXDOMAIN for `use-application-dns.net` so Firefox disables automatic DoH
- [ ] Block `doh.dns.apple.com` and subscribe to the HaGeZi `doh-vpn-proxy-bypass` list
- [ ] On the router, permit outbound port 53 and 853 only from the AdGuard host, and block outbound DoT
- [ ] In Screen Time, restrict account changes and app installs so VPN apps and DNS profiles cannot be installed
- [ ] Set iPad Private Wi-Fi Address to Fixed for the home network and pin a DHCP static lease
- [ ] Optionally install AdGuard Home's encrypted DNS profile with a ClientID such as `son-ipad`. The child can remove an unsupervised profile, so treat a loss of ClientID queries as an alert
- [ ] Alert when a managed device stops querying for 30 minutes during waking hours

**Usage estimation.** Count minutes in which a device made at least N queries to a service's domains. Label it "approximate". Query log retention 7 days, statistics 30 days, store only per-minute aggregates.

**Why AdGuard Home over the alternatives.** Pi-hole v6 has a REST API but no curated per-client blocked services catalogue with schedules. Technitium DNS Server v15 is powerful but heavier with a smaller parental-control community.

## 3. Blockchain Implementation Guidance

**Besu node.** Single validator QBFT, `--min-gas-price=0`, zero base fee in genesis, `blockperiodseconds` around 5. QBFT gives immediate finality, so one confirmation is final. Disk growth comes mostly from empty blocks. Allocate 2 to 3 GB RAM. Enable only `ETH,NET,QBFT,WEB3` RPC APIs on the internal Docker network.

**Backup and restore.** The chain data is the ledger. Back up the validator node key, backend signer key and admin key separately and encrypted. Snapshot the Besu volume nightly with the container briefly stopped. Test restore quarterly.

**Contract design (OpenZeppelin Contracts 5.x).**

- `ERC1155` plus `AccessControl`. `DEFAULT_ADMIN_ROLE` on a cold key, `MINTER_ROLE` and `BURNER_ROLE` on the backend signer.
- Token IDs encode the conversion rule. TIME converts only to screen time, MONEY only to money, FLEX to either.
- Soulbound by overriding `_update` to revert unless minting or burning, and make `setApprovalForAll` revert. Write tests against the exact release you pin.
- Store references as `bytes32` and reject reuse for idempotency.
- Children are plain addresses with no keys.
- No proxies. Immutable, versioned contracts, migrate by redeploy and replay.

**Backend signer and nonce management.** One pg-boss queue with concurrency 1 and a singleton key. viem wallet client with a local account and nonce manager. Persist pending, mined and failed. On restart, reconcile with `eth_getTransactionCount` using the pending tag.

**Indexing.** Custom indexer with viem `getLogs`, idempotent on `(blockNumber, logIndex)`. Ponder is a good second step.

**Explorer.** Blockscout needs an archive node with tracing and 8 to 16 GB RAM. Defer it. Build a Ledger screen in the parent app instead.

**Learning path.** Foundry Book and forge tests. OpenZeppelin ERC-1155 and AccessControl docs, then the soulbound contract with invariant tests. viem docs. Besu private network tutorials. Build the indexer, then rebuild with Ponder. Practise redeploy and replay as a drill.

## 4. Features

Product rules from the motivation evidence.

- Tasks are chores and effortful activities. Trampoline and LEGO earn praise or occasional surprise bonuses, not standing prices.
- Every approval comes with a short parent message.
- Offer some choice in which tasks to do.
- Use savings goals and parental matching for financial literacy, not streak pressure. Streaks, if any, forgive one missed day.
- Sibling fairness is a first-class feature.

| Priority | Feature |
|---|---|
| V1 must-have | Parent control cards with Allow, Block, Back to normal, durations, Pause everything, plain-English status and "why" |
| V1 must-have | Single-writer reconciler with read-back confirmation and failure alerts |
| V1 must-have | Tasks with reward amount and rule, parent approval with praise message |
| V1 must-have | Kiosk balance and planning, daily caps |
| V1 must-have | Grant pause and resume on parent block, refund as explicit action |
| V1 must-have | Change history and audit log in plain English |
| V1 must-have | Web Push, passkey login for both parents |
| V1 must-have | Bedtime schedule per group |
| V1 must-have | Backups and restore runbook |
| V1 nice-to-have | Savings goal, parental matching |
| V1 nice-to-have | Child request button on kiosk |
| V1 nice-to-have | Recurring tasks and chore rotation |
| V1 nice-to-have | Chore photo capture via Fully Kiosk camera, parent-only viewing |
| V1 nice-to-have | Weekly family summary (AI optional, template fallback) |
| V1 nice-to-have | Ledger screen for learning |
| V2 | Setup wizard, router detection, DHCP takeover, Tailscale onboarding |
| V2 | Multiple households tested, roles beyond parent |
| V2 | Discovery helper for unknown services, AI domain classification |
| V2 | Chore photo pre-check, rule tuning suggestions |
| V2 | Postgres ledger as default, payouts via Starling or Monzo APIs |

## 5. Interface and UX

**Parent PWA.**

- Home Screen install guidance as a three-step illustrated sheet. Safari has no install prompt.
- Request notification permission only after a tap on "Turn on alerts", inside the installed app.
- iOS web notifications support neither images nor action buttons, and there is no background sync. Notifications deep-link to a single screen with one big action.
- Respect `env(safe-area-inset-*)`, 48 pt minimum targets, Dynamic Type friendly sizing, VoiceOver.
- Status is one sentence plus colour and icon, never colour alone.
- Optimistic UI with a 10-second Undo toast, "Confirming" until read-back succeeds. Confirmation dialog only for Pause everything and refunds.

| Parent screen | Key elements |
|---|---|
| Control (home) | Child switcher, Pause everything, service and group cards with state, reason, expiry, three buttons, "takes up to a minute" |
| Duration sheet | 30 minutes, 1 hour, until bedtime, until tomorrow |
| Approvals | Pending completions and requests, approve with praise, reject with kind reason |
| Tasks | List, create, suggestions |
| Balances and history | TIME, MONEY, FLEX balances, ledger events, money owed, mark paid |
| Activity | Approximate active minutes per service, "device went quiet" alerts |
| Settings | Family, devices, groups, policies, bedtime, notifications, AI features and keys, backups |
| Ledger (learning) | Event list with block and transaction hash |

**Child kiosk.**

- Pictures first, one action per screen, 64 dp or larger targets, 20 pt minimum text, high contrast, friendly rounded type, self-hosted.
- Positive framing, never countdown anxiety or red warnings.
- Avoid heavy blur, large shadows and long animations on low-end GPUs. Target under 150 KB JavaScript.
- Fully Kiosk PLUS JavaScript interface exposes `turnScreenOff`, `forceSleep`, `showToast`, `startMotionDetection`, `stopMotionDetection`, and events via `bind('onMotion')`, `bind('screenOn')`, `bind('screenOff')` and `bind('onBatteryLevelChanged')`. Wrap them in a `kioskBridge` module that does nothing in a normal browser.

**Fire tablet constraints.** Fire OS 7 is Android 9. Fire OS 7.3.3.1 on 11th-gen devices reports Amazon WebView v120. Fire OS 5 devices should not be targeted. Build the kiosk to ES2017 and test on the actual device. Amazon announced Android 16 tablets on 8 October 2026 and plans to stop shipping the Fire line, so buy a spare device now.

**Visual style.** Shared tokens in `packages/tokens`. Calm primary, green for allowed, amber for limited, slate for blocked (avoid alarming red). Parent app follows iOS conventions with the system font. Motion under 200 ms where possible and respects `prefers-reduced-motion`.

## 6. AI and MCP Architecture

- An `ai` package wraps AI SDK 7 with a provider registry (Anthropic, OpenAI, Google, Mistral, Bedrock, Ollama), per-feature model selection, spend caps and structured output via Zod.
- Every write tool produces a proposal stored in Postgres and shown in Approvals. Nothing executes without a parent tap.
- MCP client via `@ai-sdk/mcp` with HTTP transport for weather, calendar and Home Assistant servers. Treat all tool output as untrusted.
- MCP server via `@modelcontextprotocol/server` v2, mounted at `/mcp`. Read tools on by default. Write tools return an input-required response through Multi Round-Trip Requests with signed, expiring `requestState`, and also create an in-app approval as the authoritative confirmation. Require `Mcp-Method` and `Mcp-Name` headers.
- OAuth 2.1 with the built-in passkey login as the authorisation server. Support Client ID Metadata Documents. Scope tokens to `read` and `propose`.
- Avoid deprecated MCP features (Roots, Sampling, Logging, the legacy HTTP plus SSE transport).

**Provider data policy summary.**

| Provider | Training on API data | Retention | Fit for children's data |
|---|---|---|---|
| Anthropic API | Not used for training under Commercial Terms | Deleted within 30 days per Anthropic's Privacy Center (July 2026), longer for flagged content | Good for Level 2 pseudonymised data |
| Google Gemini API, paid | Not used to improve products | Limited abuse-detection logging | Good for Level 2 on paid tier only |
| Google Gemini API, unpaid | Used to improve products, human review possible | Not stated | Not permitted for UK-facing use. Block in code |
| OpenAI API | Not used for training by default (re-verify) | Abuse monitoring, typically up to 30 days (verify) | Verify before enabling |
| Ollama local | None | Local only | Required for Level 3 |

**Local models.** On a Raspberry Pi 5 8 GB, 1B models run at roughly 11 to 22 tokens per second and 3B to 4B models at roughly 5 to 11. Fine for classification and overnight summaries, too slow for interactive control. A modest x86 server or Mac is much better.

**Safety and injection controls.** AI never calls AdGuard or the ledger directly. Wrap untrusted content in delimited data blocks. Pseudonymise child names for Level 2. No photos or raw DNS logs to the cloud by default. No child-facing chat. Hard spend caps with a kill switch.

**Recommended AI features.** V1: plain-English control proposals, task suggestions by age, weather and season, weekly summary. Later: "why is this blocked" explainer, fairness check across siblings, praise-message drafts, calendar-aware bedtime suggestions, local domain classification, chore photo pre-check, rule tuning.

**ICO Children's Code.** A self-hosted tool with no service operated by the author is likely outside its direct scope, but follow its standards anyway.

## 7. Self-Hosting and Productisation

- **Packaging.** Docker Compose bundle first. Home Assistant add-on, Umbrel and CasaOS are V2 channels. First-run wizard as a route in the API with a one-time token printed in logs.
- **Remote access.** Tailscale Personal is free for up to 6 users and unlimited user devices, for non-commercial use. Tailscale Serve gives valid HTTPS on the ts.net name.
- **UK routers.** Many ISP hubs, including BT's, do not allow DNS changes. Plan three paths: set DNS on the router, otherwise disable router DHCP and use AdGuard Home's DHCP, otherwise modem mode behind your own router.
- **Backups.** restic with an encrypted repository covering Postgres, the Besu volume, keys and AdGuard config.
- **Secrets.** Docker secrets files, AI keys encrypted at rest.
- **Licensing.** AGPL-3.0 if you want improvements from anyone hosting it as a service, MIT or Apache-2.0 for adoption. Pulling the unmodified AdGuard Home image and talking to it over HTTP does not impose GPL on your code. Take legal advice before V2.
- **UK GDPR.** Parents running it at home are likely within the domestic purposes exemption. The author's duties are security by design and honest documentation of what AI features send where.

## 8. Building With Claude Code

- Layout as in the build prompt Part 17.
- Short, specific CLAUDE.md.
- Subagents for contracts, security and UX copy.
- Hooks for typecheck and tests after edits, Foundry on contract changes, blocking edits to applied migrations.
- Domain logic test-first, AdGuard contract tests against a real container, Foundry invariant tests, Playwright WebKit and Chromium.

## Risks, Dependencies and Assumptions

| Type | Item | Mitigation |
|---|---|---|
| Risk | DNS enforcement lag and in-progress sessions | "Takes up to a minute" copy, Screen Time backstop, read-back confirmation |
| Risk | Bypass via Private Relay, DoH, VPN or mobile data | Checklist above, quiet-device alert |
| Risk | Grant expiry depends on the control service being up | Health check, push alert, restart policies |
| Risk | Rewarding enjoyed activities undermines motivation | Product rules in section 4 |
| Risk | AdGuard Home 1.0 changes the API | Pin 0.107.79, contract tests |
| Risk | Fire tablet WebView too old, Fire line discontinued | Fire OS 7 device, ES2017 kiosk, buy a spare |
| Risk | Single-validator chain data loss | Encrypted key backups, nightly snapshots, replay from Postgres |
| Risk | AI SDK and MCP churn | Pin exact versions, isolate in `packages/ai` |
| Dependency | Fully Kiosk PLUS licence, AdGuard Home, Besu, Tailscale terms | Track releases |
| Assumption | Several package versions unverified | Pin at scaffold, record in `docs/versions.md` |
