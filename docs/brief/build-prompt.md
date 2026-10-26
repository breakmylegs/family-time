# Claude Code build prompt: family screen time and rewards platform, V1

Fill the VALUES block, put the reference files in place, then paste everything between PROMPT STARTS HERE and PROMPT ENDS HERE into a new Claude Code session started at the repo root in plan mode.

## Before you paste

1. Create an empty repo. Working name `family-time`. The name lives in one config constant so it can change later.
2. Unzip the pack so these files sit in the repo. Claude Code cannot see the chat where this was designed, so these files are its only source of the research and design.

| File | Source |
|---|---|
| `docs/research/01-feasibility.md` | First feasibility report (Apple constraints, architecture options) |
| `docs/research/02-v1-research.md` | V1 Research Report, October 2026 (stack, AdGuard, Besu, UX, AI, MCP) |
| `docs/research/03-motivation.md` | Motivating Less Screen Time report (economics, features, pilot plan) |
| `docs/design/mock-screens.html` | The mock screens file. Visual source of truth |

3. Make the sibling platforms readable by this session. Clone them read-only somewhere outside the repo, for example `~/src/reference/<app>`, and fill in the paths below. If a repo is not available, delete its row and paste any reusable prompts you have (operability standardisation, backup and DR, SAML SP, SCIM, security standardisation) into `docs/reference/`.
4. IP check. Some sibling apps were built for work. V2 of this platform will be public. Tell Claude Code to reuse patterns and conventions from those apps, and only copy code from repos you personally own. The prompt already says this.

## VALUES

```
APP_NAME              = family-time
PUBLIC_HOSTNAME       = family.<your-domain>            # parent app, behind your existing Caddy
KIOSK_LAN_URL         = http://<home-server-lan-ip>:<port>/kiosk
DEPLOY_TARGET         = Proxmox VM, Ubuntu 24.04, Docker Compose   # avoid Docker inside an unprivileged LXC
PROXY_NETWORK         = proxy_net                       # the external Docker network your Caddy uses
REMOTE_ACCESS         = caddy-public                    # or tailscale
OWNER_SSO             = none                            # or authentik-oidc
TIMEZONE              = Europe/London
CHILD_NAME            = <son's name>
CHILD_AGE_BAND        = 8-10                            # 5-7 | 8-10 | 11-13 | 14+
WEEKLY_ALLOWANCE_MIN  = 420                             # set from the two-week baseline, minus no more than 10%
WEEK_RESETS           = Sunday 18:00
UNUSED_BONUS          = 10p per 30 min, cap 100p per week
SCHEDULE_SCHOOL_NIGHT = free 15:30, tea pause 17:30 to 18:15, wind-down 19:30, bed 20:30
SCHEDULE_WEEKEND      = <fill in>
SIBLING_REPOS         =
  reckoner     ~/src/reference/reckoner
  estimatrix   ~/src/reference/estimatrix
  brightline   ~/src/reference/brightline
  clauseworks  ~/src/reference/clauseworks
  proscenia    ~/src/reference/proscenia
  peter        ~/src/reference/peter
  muster       ~/src/reference/muster
  shared       ~/src/reference/_shared
```

---

# PROMPT STARTS HERE

## How we work

You are building V1 of a self-hosted family screen time and rewards platform. V1 is for one family (mine) to test for 16 weeks. V2 will be a public release that other parents run in their own homes, so every V1 decision must work for a generic household, not just mine.

Working agreements.

- Plan before code. At the start of each phase, write the plan, list the files you will touch, and wait for my approval.
- One phase per branch. Small commits with conventional commit messages.
- Domain logic is test-first.
- Never edit an applied migration. Add a new one.
- Ask before anything that touches my home network, router, live DNS, or any container outside this project.
- Ask before adding a dependency that is not in Part 17. Record every pinned version in `docs/versions.md`.
- When a fact in the research docs conflicts with what you find in the code, docs or package registry today, say so and tell me which you believe and why. Do not work around it silently.
- When something here cannot be done safely, say so and explain what it would take. Nothing here is worth shipping a broken control plane for. This app decides whether a child's internet works.

Read the VALUES block above this prompt. Where a value is still a placeholder, use the default shown and list it under open questions in your first report.

## Part 0. Read first, then report

Before writing any code, read these in full.

1. `docs/research/00-read-me-first.md` first. It sets which document wins when they disagree and lists every decision that replaced an earlier recommendation. Then `01-feasibility.md`, `02-v1-research.md` and `03-motivation.md`.
2. `docs/design/mock-screens.html` and `docs/design/README.md`. Open the mock in a browser with Playwright and screenshot every view in light and dark. Reference captures are already in `docs/design/screenshots/`. It is the visual source of truth for the parent app, help panel, bottom sheets, approvals and kiosk.
3. The sibling repos listed in SIBLING_REPOS, read-only. They are my other platforms, built with you in earlier sessions. Harvest patterns for:
   - user accounts, roles, invites, session handling, and the admin console layout
   - SAML SP and SCIM integration with Authentik, SSO enforcement, and the CLI maintenance mode
   - AI provider connectors, especially Brightline's Bedrock integration and any provider registry, key storage, model selection, cost tracking or guardrails
   - `scripts/update.sh` and the deployment contract, including image tagging, health-gated restart and rollback
   - backup and disaster recovery scripts, restore drills and size assertions
   - `/healthz`, `/readyz`, `/version` with the commit baked in at build, structured logging with health checks at debug level
   - the System or About page, audit log viewer, in-app release notes, data retention jobs and export
   - Caddy blocks, Docker Compose conventions, memory limits, multi-arch builds and the external proxy network
   - any verification script that probes a running app

Rules for reuse.

- Reuse patterns, conventions and shapes. Only copy code verbatim from repos I personally own, and ask me first. Some sibling apps were built for my employer and V2 of this platform is public.
- The sibling apps use different stacks. This project uses the stack in Part 17. Translate patterns into it. Do not switch this project's stack to match a sibling app.
- Where sibling apps disagree with each other, pick the strongest version and say why.

Deliver `docs/reuse-report.md` containing, for each pattern above, where you found it (repo, file, line), what you will reuse, what you will change and why, and anything missing that this project needs. Then stop and wait for my approval before Phase 0.

## Part 1. What the product is

- Parents control when apps work on their child's devices, at the network level, using AdGuard Home as the home DNS server. It covers any device on home Wi-Fi.
- The child gets a weekly screen time allowance agreed with the family. He plans it himself on a kiosk tablet in 30-minute blocks.
- Off-screen jobs earn pocket money or flex points, approved by a parent with a short note of praise. Things he already loves get praise only.
- Unused allowance turns into pocket money at the end of the week. The allowance comes down gradually in steps agreed at a weekly family review.
- Points live on a ledger. In V1 that ledger can run on a local private blockchain, because I want to learn it. The ledger sits behind an interface so V2 can use a plain Postgres ledger.
- Optional AI features help parents, never the child, and can only propose actions a parent approves.
- Every screen in the parent app explains itself through (?) help icons that open a right-hand panel, including why the feature helps reduce screen time and how strong the evidence is.

Users.

- Mum is not technical. She uses the parent app on her iPhone, one-handed, often in the kitchen at teatime. If Mum cannot do a task unaided, the task is not done.
- I am technical and own the system.
- The child uses an old Amazon Fire tablet in kiosk mode. He never logs into anything else.

## Part 2. Fixed decisions and constraints

These are settled. Raise a concern if you find a serious problem, but do not change them without my approval.

- No paid Apple Developer account. No native iOS app, no FamilyControls, ManagedSettings or DeviceActivity. Apple Screen Time stays on the child's iPad as the outer safety net for Downtime and for apps this platform does not manage.
- Enforcement is DNS only, through AdGuard Home's HTTP API. It only works on home Wi-Fi. Blocks stop new connections, so a video already playing or a game already running can carry on. All copy must say "takes up to a minute".
- One backend control service is the only writer to AdGuard. Nothing else writes to it, including the parent app and AI.
- Parent app is a Progressive Web App on iPhone Safari, installed to the Home Screen, with Web Push.
- Kiosk is a web page shown in Fully Kiosk Browser on an old Fire tablet, LAN only, firewalled to the home server. Treat the WebView as old Chromium. Build to ES2017.
- One install per home. No central cloud and no data leaves the home except optional AI calls the parent has switched on.
- British English everywhere. Times in 24-hour format, stored in UTC, displayed in Europe/London.
- No em dashes or en dashes in any user-facing copy, help content or docs. Use "to" for ranges.

## Part 3. Domain model

Build the generic household model from the first migration. V1 data must upgrade into V2 without a rebuild.

| Entity | Key fields |
|---|---|
| Household | id, name, timezone, week reset time, feature flags, pilot phase |
| Person | id, household, display name, role (owner, parent, carer, child), avatar colour |
| Credential | passkeys per person, optional OIDC subject for the owner |
| Device | id, household, child (nullable for shared), label, type (ipad, console, laptop, kiosk), AdGuard client id, MAC and ClientID identifiers, last seen |
| Service | id, name, icon, source (adguard-builtin with service id, or custom with domain list), category |
| Group | id, household, name (Video, Games, Social, Chat by default), members |
| Policy | child, group or service, default (blocked or allowed), earnable, always-allowed flag, allowed during wind-down flag, daily cap, single-session cap |
| Schedule | household or child, weekday set, blocks with type (school, pause, wind-down, bed, free) and times |
| Override | target (service, group or everything), child, type (allow, block, pause), start, end or until-resume, created by, counts against allowance |
| Grant | child, service or group, start, end, minutes, source (planned by child, approved request), status (scheduled, active, paused, ended, refunded) |
| Task | household, title, picture, reward type (money, flex, time, praise), amount, recurrence, age band, needs photo |
| Completion | task, child, logged at, photo (local only), status (waiting, approved, not yet), parent note, approved by |
| Request | child, kind (time beyond plan, specific session), detail, status, decided by |
| Goal | child, title, target pence, matching percent (optional) |
| LedgerEntry | read model of every ledger event with tx reference |
| Proposal | source (ai feature, mcp client), action payload, status, decided by |
| AuditEvent | who, what, when, before, after |
| PushSubscription, HelpFeedback, MetricEvent | as needed |

## Part 4. The control engine

Pure TypeScript in `packages/domain`. No I/O. Given the time, the household's schedules, policies, overrides and grants, it returns the desired state for every device and service, plus a reason a parent can read.

Precedence, highest first.

1. **Pause.** A manual Pause everything, or a scheduled routine pause such as tea. Blocks every managed service.
2. **Parent override.** Allow or block a service, group or everything for a set time. Always has an end, or until resume.
3. **Schedule blocks.** School hours, wind-down and bed. A service with "allowed during wind-down" is exempt from wind-down only.
4. **Allowed time.** An active grant the child planned or a parent approved, or a service marked always allowed (homework tools, video calls with family).
5. **Default.** The policy default, normally blocked.

Rules.

- Overrides always expire back to normal. There is no "forever" option.
- When a parent blocks a service during an active grant, the grant pauses and the unused minutes go back to the child when the block ends. Refund as points is a separate explicit parent action.
- Every computed state carries a reason string in plain English, for example "Ollie planned 30 minutes of his time" or "Not planned today. Usual school-night rule". The parent app shows these verbatim.
- Property tests with fast-check for precedence, expiry, grant pause and resume, and timezone and daylight saving boundaries. Use a fake clock everywhere.

## Part 5. AdGuard Home integration

- Pin `adguard/adguardhome:v0.107.79` unless a newer 0.107.x patch exists. Do not use the 1.0 beta.
- Generate a typed client in `packages/adguard-client` from AdGuard's OpenAPI spec. Write contract tests against a real AdGuard container in CI.
- One AdGuard persistent client per physical device, `use_global_blocked_services: false`. Map devices to children in our database, not in AdGuard.
- Built-in services (YouTube, Roblox and others) go in the client's `blocked_services`. Custom services become per-device rules using `$client`, inside a managed block delimited by marker comments. Never touch rules outside our markers.
- The reconciler is a pg-boss singleton job. It runs every 60 seconds and after every change. It reads the full client, diffs against desired state, writes the full object back with `POST /control/clients/update` (the API replaces the whole client), then reads again to confirm.
- The parent app shows "Starting. Takes up to a minute", then "Working on his iPad now" once read-back confirms. After three failed confirmations, the card says "Not confirmed" and parents get a push.
- Global settings applied once with my approval: `blocked_response_ttl` 10, `cache_ttl_max` 60, query log retention 7 days, statistics 30 days.
- Bypass rules installed globally: NXDOMAIN for `mask.icloud.com` and `mask-h2.icloud.com` (iCloud Private Relay), NXDOMAIN for `use-application-dns.net` (Firefox DoH canary), block `doh.dns.apple.com`, and subscribe to the HaGeZi `doh-vpn-proxy-bypass` list. Write the router-side checklist (force port 53 to AdGuard, block outbound DoT on 853) into `docs/setup/network.md`. Do not change the router yourself.
- Device health. If a managed device stops querying for 30 minutes during waking hours, push "Ollie's iPad has gone quiet" to parents. That usually means mobile data, a VPN or other DNS.
- Usage estimate. From the query log, count minutes in which a device made at least N queries to a service's domains. Show it as "about 25 min". Store per-minute aggregates only. Raw query logs are Level 3 data and never leave the server.
- Service discovery helper. Show the top domains a device used in the last 30 minutes so a parent can turn a new game into a custom service.
- AdGuard's admin UI and API are only reachable on the internal Docker network. DNS port 53 is published on the server's LAN address only.

## Part 6. Points economy

These rules come from the motivation research. They are product rules, not suggestions.

- **Weekly allowance is agreed, not earned.** At each week reset the child receives his allowance as TIME. It does not roll over.
- **Chores earn MONEY or FLEX by default.** TIME is available as a task reward, but earned TIME is capped at 15% of the weekly allowance per week. The task editor nudges parents towards MONEY or FLEX with a (?) explaining why.
- **Praise only.** Tasks for things the child already enjoys (LEGO, trampoline, drawing) carry no points. Approving sends praise. The (?) explains the overjustification research.
- **Every approval invites a short note.** Offer three suggested phrases. The note shows on the kiosk.
- **Unused-time bonus.** At week reset, remaining TIME is burned and converted to MONEY at the household rate, capped per week. Default 10p per full 30 minutes, cap £1.
- **Gradual reduction plan.** Step size, interval, floor and next step date. A step only takes effect after a parent ticks "agreed at the family review".
- **Planning.** The child plans sessions on the kiosk in 30-minute blocks within the allowed windows, the daily cap and the single-session cap. Planning burns TIME. A parent block during the grant pauses it, and minutes not used are refunded by a ledger refund event.
- **Requests.** The child can ask for something outside his plan. It becomes an approval for parents. Approving creates a grant that uses his allowance.
- **Money.** MONEY balance is what parents owe. Parents mark payouts manually in V1. Savings goal progress reads from MONEY. Optional parental matching is a V1 nice-to-have.
- **Never** deduct points as punishment, never add leaderboards between siblings, never use loss-framed streaks, never use variable or surprise rewards generated by the system. Surprise praise from a parent is fine.

## Part 7. Ledger

Define `LedgerPort` in `packages/ledger`: award, allocateAllowance, spendTime, refund, convert, closeWeek, recordPayout, balances, history, verify. Every call takes an idempotency reference.

Two adapters, both kept.

- **Postgres hash-chained ledger.** Build this first (Phase 4). Append-only table, each row stores the SHA-256 of the previous row's hash plus the canonical JSON of the entry, single serialised writer, nightly chain verification with an alert on any break. Corrections are compensating entries. This is the V2 default.
- **Besu adapter.** Built in Phase 5 for learning. Same tests must pass against both adapters.

Besu.

- Hyperledger Besu 26.10.x (verify the repo, which moved to besu-eth/besu, and that the tag publishes linux/arm64). Single validator, QBFT, free gas (`min-gas-price=0`, zero base fee in genesis), block period about 5 seconds. Only `ETH,NET,QBFT,WEB3` RPC APIs, internal Docker network only. Limit the JVM to about 2 to 3 GB.
- QBFT gives immediate finality, so the indexer treats one confirmation as final.
- Compose profile `ledger-besu` so the stack runs without it.

Contract (Foundry, OpenZeppelin Contracts 5.x, Solidity pinned).

- ERC-1155 plus AccessControl. Token ids TIME (minutes), MONEY (pence), FLEX (points). `DEFAULT_ADMIN_ROLE` on a cold key kept offline, `MINTER_ROLE` and `BURNER_ROLE` on the backend signer.
- Soulbound. Override `_update` to revert unless minting or burning, and make `setApprovalForAll` revert.
- Enforce conversion rules on chain. TIME spends only on screen time. MONEY only pays out. FLEX converts to either at household rates.
- Every mint and burn carries a `bytes32` reference and reason code, and a used reference reverts. Events include `TaskRewarded`, `AllowanceAllocated`, `TimeSpent`, `TimeRefunded`, `WeekClosed`, `Converted`, `PayoutRecorded`.
- No proxies. Deploy immutable, versioned contracts and migrate by redeploy and replay from the Postgres event history.
- Invariant and fuzz tests. Supply equals minted minus burned. No transfer ever succeeds. A reference is never reused.

Backend signer and indexer.

- One pg-boss queue, concurrency 1, singleton key. viem wallet client with a local account and nonce manager. Persist pending, mined and failed. On restart, reconcile with `eth_getTransactionCount` using the pending tag.
- Custom indexer with viem `getLogs` from the last processed block into the `LedgerEntry` read model, idempotent on block number and log index.
- A Ledger screen in the parent app lists every event with block number and transaction hash. Owner only.

Keys. Validator node key, backend signer key and admin key are generated by `scripts/init.sh`, stored as Docker secrets, and backed up separately and encrypted.

## Part 8. Accounts, roles and security

Reuse the account and role patterns from the sibling apps, translated into this stack.

| Role | Can do |
|---|---|
| Owner | Everything, including users, devices, system settings, AI keys, MCP clients, backups, ledger screen |
| Parent | Control, approvals, tasks, children, schedules, allowance and taper, help, AI features already enabled by the owner |
| Carer | View status, pause everything, approve requests within the plan. No rule changes. Optional, for grandparents |
| Child | No login. Represented by a profile used on the kiosk, optional 4-digit PIN when there are siblings |
| Kiosk device | Long-lived revocable device token, scoped to the kiosk API |
| MCP client | OAuth token with `read` or `read propose` scope |

- Passkeys first, with SimpleWebAuthn. Mum signs in with Face ID. Invites by link or QR code, no email dependency.
- Owner recovery through a CLI command that issues a one-time recovery link, like the sibling apps' maintenance mode CLI. Protect the owner account from deletion at the database level.
- Optional owner login through Authentik with OIDC (`openid-client`), following the sibling apps' SSO patterns, when OWNER_SSO is set.
- Secure, HttpOnly, SameSite cookies, CSRF protection, rate limits on auth endpoints, audit events for every privileged action.
- Secrets live in Docker secrets files created by `scripts/init.sh`, never in the repo. AI keys are encrypted at rest with AES-256-GCM under a master key held as a Docker secret. Keys are write-only in the UI, showing the last four characters.

## Part 9. Parent app

React 19, Vite, Tailwind 4, shadcn/ui on Radix, iPhone-first. Match the mock. Light and dark from the start.

Baseline from Emil Kowalski's mobile-native skill before the first component: `viewport-fit=cover`, safe-area insets, `100dvh` app shell, tap highlight off, `touch-action: manipulation`, 16px inputs, `:active` press feedback, hover only inside `(hover: hover) and (pointer: fine)`, `overscroll-behavior`, `theme-color` per colour scheme.

Screens for V1.

| Screen | Contents |
|---|---|
| Control (home) | Child switcher, plain-English status line, today rail (the household day as a timetable strip with a Now marker and pause overlay), Pause everything with (?), Right now list with Allow, Block and Normal per service or group, This week (time left as 30-minute blocks, unused bonus, reduction plan), Today history |
| Allow, Block and Pause sheets | Four durations with end times, button label names the exact action, "Count it in his weekly time" switch for Allow, "takes up to a minute" note, grant pause note when blocking planned time |
| Approvals | Completions with photo, praise-only items, requests. Suggested praise phrases, Approve, Not yet, Send praise. Collapse on decision with undo toast |
| Tasks | Create and edit tasks, reward type with the 15% TIME cap visible, praise-only, recurrence, age band, AI suggestions when enabled |
| Family | Weekly family review agenda, reduction plan steps with "agreed at review" tick, savings goal, children and devices |
| Settings | People and roles, devices and AdGuard clients, groups and policies, schedules, notifications, AI features and keys (owner), MCP clients (owner), help icons on or off, System page (owner) |
| System (owner) | Version, commit, schema version, uptime, last backup, reconciler health, AdGuard and Besu status, feature flags, release notes, audit log viewer, export |

Behaviour.

- Optimistic UI with a 10-second Undo toast. Confirmation sheets only for Pause everything and refunds.
- Server-Sent Events for live state, with 30-second polling as a fallback. Caddy needs `flush_interval -1` on the SSE route.
- Session-end conflict tap. After a block or grant ends, parents can tap calm, grumble or meltdown. Optional, one tap, used by the pilot metrics.
- Run Impeccable's critique, audit and polish, and Emil's review-animations, at the end of every UI phase. Fix what they find before asking me to review.

## Part 10. Help panel system

- Every feature that a parent configures or acts on has a (?) button with a 44-point tap target and a spoken label ("Help: Unused-time bonus").
- Tapping it opens a right-hand panel. Near full width on iPhone with the page dimmed behind, about 400px docked on wider screens. Closes with a close button, a tap outside, swipe right or Escape. Focus returns to the trigger. One panel, content swaps between topics, with a back link when following related topics.
- Topic links are deep-linkable (`?help=topic-id`) so notifications and the weekly review can open a specific explanation.
- Panel sections, in order: title, In short, How to use it, How it works (explanation-only topics), Why it helps (only where relevant), evidence badge (three-bar meter, Strong, Moderate or Early, plus one line), What your child sees (rendered in the kiosk font), Watch out for, Right now (live values), The research (collapsed), Related, Was this helpful.
- Content lives in `packages/help-content`, one Markdown file per topic with frontmatter (id, title, evidence level, source ids, last reviewed, related). Sources live in one `sources.yaml`. Content is bundled at build and works offline.
- Writing rules. Plain English for Mum. Say "linked to" unless a trial showed cause. Research claims come only from reviewed content and are never generated by AI at runtime.
- Build fails if a help button points to a missing topic, or a topic with an evidence badge has no source. Warn when a topic has not been reviewed for 12 months.
- Help feedback is stored locally.
- Seed topics are in Appendix A. Use their text, adjusted for the child's name at runtime.

## Part 11. Kiosk

Preact, Vite, plain CSS custom properties (no Tailwind 4 here), ES2017 target, under 150 KB of JavaScript, Poppins self-hosted. Landscape 1280 by 800 CSS pixels. Match the mock.

Screens.

| Screen | Contents |
|---|---|
| Home | Greeting, clock, wind-down pill, Right now (current session and minutes left), This week as 30-minute blocks with "Blocks you save turn into 10p on Sunday", Plan my time, What's planned, My jobs with I did it, savings goal, Bored? row of the child's own ideas |
| Plan my time | Choose app or group, start now or later today, 30 or 60 minutes, blocks it costs, what is left after. Greyed windows explain why ("Wind-down starts at 19:30") |
| I did it | Optional photo through the Fully Kiosk camera, then "With Mum or Dad" |
| Ask a grown-up | Request outside the plan |
| Sunday reflection | Three short questions about the week and his goal for next week |
| Night mode | Calm bedtime screen, screen off on a timer |

Copy correction to the mock. DNS cannot see the end of a video. Replace "It'll stop at the end of the video you're watching" with "New videos won't start after 19:00. The one you're watching can finish."

Fully Kiosk. Wrap its JavaScript interface in a `kioskBridge` module that does nothing in a normal browser. Use motion detection to wake the screen, a screen-off timer at bedtime, and reload on screen-on. Write the Fire tablet setup steps (APK install, PLUS licence, kiosk mode, ADB fix for the Home button delay, router firewall) into `docs/setup/kiosk.md`.

No AI anywhere on the kiosk. No (?) icons on the kiosk. The child can always see a "What Mum and Dad can see" screen in plain words.

## Part 12. Notifications and real time

- Web Push with VAPID keys generated at first boot, Declarative Web Push payloads where supported. Ask for permission only after a tap on "Turn on alerts" inside the installed app.
- Notifications deep-link to one screen with one obvious action. iOS web notifications have no action buttons.
- V1 notifications: new completion or request, reconcile not confirmed, device gone quiet, AdGuard or ledger unhealthy, weekly review reminder, nightly backup failure.

## Part 13. AI and MCP

AI is optional, off by default, and the platform must work fully with it switched off.

- `packages/ai` wraps Vercel AI SDK 7 (verify the current major at scaffold, it was 7.0 in June 2026 and needs Node 22 or later). Reuse the provider connector patterns from the sibling apps, especially Brightline, for the provider registry, model selection, key handling and cost tracking.
- Providers: Anthropic, OpenAI, Google (paid tier only, enforced in code because the unpaid tier is not permitted for UK-facing use), Mistral, Amazon Bedrock, and Ollama for local models.
- Feature registry. Each feature declares its data level, whether it can propose actions, its model, its monthly cap and its non-AI fallback. Parents switch features on one at a time.
- Data levels. Level 1 sent freely (task titles, service names, totals). Level 2 opt-in with child names replaced by "Child A" (domain lists, routine patterns). Level 3 local models only by default (photos, raw DNS logs, wellbeing answers). The settings screen shows which levels each feature sends.
- AI only proposes. Write actions become Proposal rows shown in Approvals. Nothing executes without a parent tap. Use AI SDK 7's tool approval mechanism for this.
- Untrusted content (calendar events, domain names, MCP results, anything the child typed) is wrapped as data and never sets tool arguments without schema and allow-list checks. Flows that read untrusted content get no write tools.
- Spend caps per feature and per month with a kill switch. Audit every AI call with feature, provider, model, tokens and data levels.

V1 AI features.

1. Plain-English control. "Let him have YouTube until tea" becomes a proposal card to approve.
2. Task suggestions by age band, weather and season.
3. Weekly family summary from aggregates only, with a template fallback.

MCP.

- Build against the MCP 2026-07-28 specification with TypeScript SDK v2 (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`).
- MCP server at `/mcp` behind Caddy. Read tools on by default (status, week, history, pending approvals). Propose tools (propose_override, propose_pause, propose_approval) create proposals that need a parent tap in the app. Use Multi Round-Trip Requests with signed, expiring `requestState` for confirmation flows. Validate the `Mcp-Method` and `Mcp-Name` headers.
- OAuth 2.1 with this platform as the authorisation server, passkey login, Client ID Metadata Documents, scopes `read` and `propose`. Owner registers MCP clients in Settings.
- MCP client through `@ai-sdk/mcp` with HTTP transport, for a weather server in V1. Owner approves each server and each tool. Treat all results as untrusted.
- Do not use deprecated MCP features (Roots, Sampling, Logging, the legacy HTTP plus SSE transport).

## Part 14. Measurement and the family pilot

The V1 pilot runs in phases controlled by a household feature flag. The platform must support every phase without code changes.

| Pilot phase | Weeks | What is switched on |
|---|---|---|
| baseline | 1 to 2 | Logging only. Current rules, no economics |
| reframe | 3 to 4 | Weekly allowance, chores move to MONEY and FLEX, first family review |
| reward-less | 5 to 8 | Unused-time bonus, Sunday reflection, child goal, boredom menu |
| transitions | 9 to 12 | Session-end grace, parents' own screen time card, a family challenge |
| taper | 13 to 16 | First reduction step if agreed, second wellbeing check |

Metrics, shown on a parent dashboard and exportable: managed minutes per service per week, unused minutes converted, offline activity variety, session-end conflict taps, wind-down and bedtime compliance, completions approved, and an optional monthly wellbeing check (parent mood check under 8, and a validated child scale for 8 and over only after I confirm its licence). The child sees only three things: progress towards his own goal, unused minutes converted this week, and his savings goal.

## Part 15. Operability

Match the conventions you found in the sibling apps. At minimum:

- `/healthz` liveness, `/readyz` readiness with Postgres, AdGuard, Besu (when enabled) and worker heartbeat, `/version` with commit, build time and schema version baked into the image at build.
- Structured JSON logs. Health checks at debug level.
- `scripts/init.sh` creates secrets, VAPID keys, ledger keys and the owner invite.
- `scripts/update.sh` pulls, builds images tagged with the commit, runs migrations, restarts health-gated, and rolls back automatically to the previous tag if readiness fails. Prove rollback by forcing a failure once.
- `scripts/backup.sh` dumps Postgres, snapshots the Besu volume (container stopped briefly), copies AdGuard config and secrets into an encrypted restic repository, asserts the dump is complete and above a minimum size, and rotates. `scripts/restore.sh` restores into a scratch project. A backup never restored is not a backup.
- `scripts/verify.sh` probes the running app the way the sibling verification script does.
- Maintenance mode through the CLI.
- Retention jobs for sessions, audit events, metric events, photos (approval plus 30 days) and raw query log aggregates. Export of household data as documented JSON.
- In-app release notes from `CHANGELOG.md`.

## Part 16. Containerisation and deployment

- Everything runs in Docker Compose. Multi-arch images (linux/amd64 and linux/arm64) built with `docker buildx`, because V2 targets Raspberry Pi 5 and my Oracle server is Ampere.
- Services: api, worker, parent (static), kiosk (static), postgres, adguard, besu (profile `ledger-besu`), ollama (profile `ai-local`). The api serves the static builds if that is simpler. Say which you chose and why.
- Join the external PROXY_NETWORK for Caddy. Provide a Caddy snippet in `deploy/caddy/` matching my existing style. The parent app and `/mcp` are public through Caddy. The kiosk is LAN only. AdGuard admin, Besu RPC and Postgres are internal only.
- Memory limits on every service, sized for a Pi 5 with 8 GB.
- Restart policies, health checks in Compose, a systemd unit for autostart.
- If REMOTE_ACCESS is tailscale, add a Tailscale sidecar using Serve for HTTPS on the ts.net name instead of the Caddy route.

## Part 17. Repo layout and stack

```
apps/api            Fastify 5, Zod, Drizzle, pg-boss, SSE, MCP server
apps/worker         reconciler, ledger signer and indexer, week close, retention, backups trigger
apps/parent         React 19, Vite, Tailwind 4, shadcn/ui, service worker, Web Push
apps/kiosk          Preact, Vite, plain CSS, ES2017
packages/domain     control engine, economy rules, pure and tested
packages/schemas    Zod schemas shared by everything, including AI structured output
packages/adguard-client   generated client and contract tests
packages/ledger     LedgerPort, Postgres adapter, Besu adapter
packages/ai         provider registry, feature registry, proposals, caps, audit
packages/help-content     topics, sources.yaml, build checks
packages/tokens     design tokens shared by parent and kiosk
contracts/          Foundry project
deploy/             compose files, Caddy snippet, systemd unit, Tailscale profile
scripts/            init, update, backup, restore, verify, maintenance
docs/               research, design, setup, adr, versions.md, reuse-report.md
```

Stack. Pin exact versions after verifying each on the registry at scaffold time. These were current in late October 2026.

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 LTS |
| Monorepo | pnpm workspaces, Turborepo |
| API | Fastify 5.x, Zod 4.x |
| Database | PostgreSQL 18, Drizzle ORM 0.45 stable (move to 1.0 when it is GA) |
| Jobs | pg-boss |
| Parent | React 19, Vite 8, Tailwind 4.3, shadcn/ui, vite-plugin-pwa in injectManifest mode if it supports Vite 8, otherwise a small hand-written service worker |
| Kiosk | Preact 10, Vite, plain CSS |
| Auth | @simplewebauthn/server and browser, openid-client |
| Push | web-push with VAPID |
| AI | ai 7.x, @ai-sdk providers, @ai-sdk/mcp |
| MCP | @modelcontextprotocol/server and client 2.x |
| DNS | adguard/adguardhome v0.107.79 |
| Ledger | Hyperledger Besu 26.10.x, OpenZeppelin Contracts 5.x, Foundry 1.8.x, viem 2.x |
| Tests | Vitest 5, fast-check, Playwright (WebKit for parent, Chromium for kiosk), forge test |

## Part 18. Design system and copy

- Extract tokens from `docs/design/mock-screens.html` into `packages/tokens`: the loch teal shell, mist ground, moss for allowed, slate for blocked, heather for paused and wind-down, sunflower for savings, and every dark mode value.
- Typography. Parent app uses the iPhone system font. Help panel titles and lead text use Lora. Kiosk uses Poppins. Self-host every font file, no hosted font stylesheets.
- Motion. Ease-out for entering and exiting, ease-in-out for things moving on screen, the drawer curve for the panel and sheets, under 300ms for UI, exits faster than entrances, press feedback at scale 0.97, `prefers-reduced-motion` respected. No bounce, no pulsing dots.
- Avoid Impeccable's slop catalogue: no labels above headings, no identical card grids, no gradient text, no glass, no side-tab borders, no emoji as icons. Icons are one consistent stroke set.
- Copy. Plain verbs, sentence case, controls name their action, errors say what went wrong and how to fix it. Positive framing on the kiosk, never countdown anxiety. No em dashes or en dashes anywhere. Add a lint check that fails the build if user-facing strings or help content contain them.
- Accessibility to WCAG 2.2 AA. Test with VoiceOver on the parent app.

## Part 19. Testing and quality gates

- Domain logic test-first with property tests and a fake clock. Simulate a full week, including week close, bonus, taper step and a daylight saving change.
- AdGuard contract tests against a real container.
- Ledger tests run against both adapters. Foundry invariant and fuzz tests for the contract.
- Playwright: WebKit for the parent PWA at 390 by 844, Chromium for the kiosk at 1280 by 800, light and dark. Screenshot every screen per phase into `docs/screens/` so I can review without running anything.
- CI runs lint, typecheck, unit, contract, ledger, Playwright and the help content checks. Nothing merges red.

## Part 20. Claude Code setup

Create these in Phase 0.

- `CLAUDE.md`, short and specific: commands, the precedence order, the single AdGuard writer rule, AI proposes only, ledger behind the port, British English with no em or en dashes, never edit applied migrations, where the research and mock live.
- Subagents: contracts reviewer (Solidity and Foundry), security reviewer (auth, MCP, injection, secrets), UX copy reviewer (plain English, positive framing, no dashes), help content reviewer (every claim matches a source and its evidence level).
- Hooks: typecheck and affected tests after edits, `forge fmt` and `forge test` when `contracts/` changes, block edits to applied migrations, run the dash lint on copy changes.
- Skills: install Impeccable and Emil Kowalski's skills (`npx skills@latest add emilkowalski/skills`) for UI phases. Write project skills for "add a service to the catalogue" and "add a help topic".
- ADRs in `docs/adr/` for every decision that is hard to reverse.

## Part 21. Phases and exit criteria

Stop at the end of every phase and report back (Part 23). Do not start the next phase until I approve.

| Phase | Scope | Exit criteria |
|---|---|---|
| 0. Foundations | Reuse report approved, monorepo, CLAUDE.md, subagents, hooks, Compose skeleton, health, version and logging, init and update scripts, CI | Stack comes up healthy, `update.sh` deploys and rolls back on a forced failure, CI green |
| 1. Accounts and roles | Household model migration, passkeys, roles, invites, owner recovery CLI, optional OIDC, audit log | I and Mum sign in with Face ID on our iPhones. Role tests pass |
| 2. Control engine and AdGuard | Catalogue, devices, groups, policies, schedules, precedence engine, reconciler, bypass rules, device health, usage estimate, baseline logging | YouTube and Roblox block and unblock on the iPad within 60 seconds with read-back confirmed |
| 3. Parent app control | Control screen, sheets, Pause everything, history, SSE, Web Push, help panel system with seed topics, conflict tap | Mum allows, blocks and pauses unaided, and opens and understands three help topics |
| 4. Economy on Postgres ledger | LedgerPort, Postgres adapter, allowance, tasks, approvals with praise, praise only, requests, planning grants, grant pause and refund, week close and bonus, reduction plan, payouts | A full simulated week passes with the fake clock, including bonus and a taper step |
| 5. Besu ledger | Contract and tests, Besu compose profile, signer queue, indexer, ledger screen, redeploy and replay drill | The same week passes on Besu and the read model rebuilds from chain |
| 6. Kiosk | Kiosk screens, planning, I did it with photo, requests, goal, boredom menu, Sunday reflection, night mode, Fully Kiosk bridge, setup doc | My son plans a session and logs a job on the Fire tablet without help |
| 7. AI and MCP | Provider registry, keys, feature registry, three AI features, MCP server with read and propose, MCP client for weather, caps and audit | Claude reads status over MCP and proposes an Allow that Mum approves. With all AI off, everything still works |
| 8. Hardening and pilot readiness | Backup and restore drill, verify script, retention, export, System page, release notes, accessibility audit, security review, pilot dashboard and phase flags | Restore from scratch succeeds, `verify.sh` is all green, Impeccable audit has no P0 or P1 findings |

## Part 22. Never

- Never let anything except the control service write to AdGuard.
- Never let AI execute an action, talk to the child, or run on the kiosk.
- Never build points deductions, punishments, sibling leaderboards, loss-framed streaks or system-generated variable rewards.
- Never expose AdGuard admin, Besu RPC, Postgres or the worker outside the Docker network.
- Never send Level 3 data to a cloud provider without the parent's per-feature consent, and never keep raw query logs beyond 7 days.
- Never store AI keys or secrets in plain text, in the repo or in logs.
- Never generate help content research claims at runtime.
- Never use em dashes or en dashes in anything a person reads.
- Never change my router, home DNS or other containers without asking.

## Part 23. Report back after each phase

- What you built, file by file in summary
- What you reused from the sibling apps, and from where
- What you verified and how, with the exact commands and outputs
- Screenshots of every new or changed screen in `docs/screens/`
- Every schema change, confirming each is additive and applies to a populated database
- Every pinned version added to `docs/versions.md`
- What needs a real device to confirm (iPhone, iPad, Fire tablet) and exactly what I should check
- Open risks, open questions, and anything in this prompt that conflicts with what you found, rather than working around it silently

## Appendix A. Help topic seed content

Use this text. Replace "Ollie" with the child's name at runtime. Keep the evidence levels exactly as written.

**Unused-time bonus** (evidence Moderate, one well-run trial of 70 families)
- In short. Screen time he doesn't use by Sunday turns into pocket money.
- How to use it. Set the rate, for example 10p for every 30 minutes left over. Set a weekly cap, so a quiet week has a limit. It pays out on Sunday at 18:00, straight into his savings goal.
- Why it helps. It rewards using less screen time, instead of rewarding him with more of it. In a family trial, children had a weekly screen budget that came down over time, a small payment for each unused half hour, and praise from their parents. Their screen use fell by about 17 hours a week, and the drop lasted two years.
- What he sees. "You saved 1 hour last week. That's 20p for your bike lights."
- Watch out for. Saving everything for one long weekend session. Keep the single-session limit on, and praise his choice to save, not just the money.
- Research. Epstein and colleagues, 2008. Children were aged 4 to 7, so treat the size of the effect as a guide for older children.

**Weekly allowance** (Moderate, consistent findings from studies that observed families rather than trials)
- In short. A set amount of screen time for the week, agreed with him. He plans how to use it.
- Why it helps. Studies link using screen time as a reward or a punishment to children using screens more, not less. A weekly allowance keeps screen time a plan rather than a prize, and gives him practice at budgeting.
- Watch out for. Topping it up as a reward for good behaviour. That turns screen time back into a prize.
- Research. Tang and colleagues 2019, Nagata and colleagues 2024. These show a link, not proof of cause.

**Gradual reduction plan** (Moderate, one well-run trial plus research on how children react to rules)
- In short. The weekly allowance comes down a little at a time, in steps you agree with him.
- Why it helps. Small, agreed steps are easier to stick to than a sudden cut, and they give him a say.
- Watch out for. Skipping the conversation. A cut that arrives without warning feels like a punishment.
- Research. Epstein and colleagues 2008, Valkenburg and colleagues 2013.

**Pause everything** (Moderate, studies that observed families)
- In short. Stops managed apps on his devices, within about a minute.
- Why it helps. Useful for meals, family time and the run-up to bed. Screen-free routines like these are linked to better sleep.
- Watch out for. Using it as a punishment. Studies link using screens as a reward or punishment to children using screens more, not less.
- Research. Carter and colleagues 2016, UK Chief Medical Officers 2019, Nagata and colleagues 2024.

**Allow, Block and Normal** (explanation only, no evidence badge)
- In short. Each app follows his plan and your family rules. Allow and Block let you step in for a while.
- How it works. Blocking works on your home Wi-Fi. Changes take up to a minute, and a video that's already playing may finish first. Screen Time on his iPad still applies as a backup.
- Watch out for. Allowing apps on top of his allowance most days. If it keeps happening, talk about the allowance at the family review instead.

**Praise, not prizes** (Strong, a review of 128 experiments)
- In short. Some things only get praise, because he already loves doing them.
- How to use it. Mark a task as Praise only. When he logs it, send a short message. Say what he did, not just "well done".
- Why it helps. Paying children for things they already enjoy can make them enjoy those things less, because the activity starts to feel like a job. Praise doesn't carry that risk.
- Watch out for. A surprise treat now and then is fine. Putting a price on LEGO or the trampoline is the thing to avoid.
- Research. Deci, Koestner and Ryan 1999. The effect was stronger in children than adults. Unexpected rewards made no clear difference.

**Earning screen time from chores** (Moderate, write this topic for the task editor)
- In short. Chores earn pocket money or flex points by default. Screen time as a reward is capped.
- Why it helps. When screen time is the prize, it tends to become more wanted. Keeping most rewards in money or flex points keeps the focus on the job.
- Research. Tang and colleagues 2019, Nagata and colleagues 2024, plus food-reward experiments by Birch and colleagues.

Write further topics for every other configurable feature using the same structure and the research docs. Mark each new topic "needs review" until I approve it.

## Appendix B. Sources for sources.yaml

- Epstein LH and others, 2008, Archives of Pediatrics and Adolescent Medicine. Reducing TV and computer use with a budget, payment for unused time and praise.
- Tang L and others (Haines J), 2019, BMC Obesity. Screens as rewards or punishments in young children.
- Nagata JM and others, 2024, Pediatric Research. Media parenting practices and early adolescent screen use.
- Deci EL, Koestner R, Ryan RM, 1999, Psychological Bulletin. Meta-analysis of 128 experiments on rewards and intrinsic motivation.
- Carter B and others, 2016, JAMA Pediatrics. Media devices at bedtime and sleep.
- UK Chief Medical Officers, 2019. Commentary on screen-based activities.
- Valkenburg PM and others, 2013, Human Communication Research. Autonomy-supportive parental mediation.
- Hiniker A and others, 2016, CHI. Screen time transitions in young children.
- Jones A and others, 2021, International Journal of Behavioral Nutrition and Physical Activity. Meta-analysis of screen time reduction strategies.

Verify every citation against the research docs before it ships.

# PROMPT ENDS HERE
