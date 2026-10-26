# Reuse report

Part 0 of the build prompt. What I read, what I will reuse from the sibling platforms, what I will change and why, and what nothing in the estate covers. Ends with conflicts and open questions. Nothing in Phase 0 starts until you approve this.

## What I read

- `docs/research/00` to `03`, in full.
- `docs/design/mock-screens.html`. Captured with Playwright (Chromium) at 1440 and 390 wide, light and dark, all five views: 20 screenshots in `docs/design/screenshots/`. The 10 that came in the pack are unchanged. The 10 I added are the missing dark and 390 views.
- Seven sibling repos, read-only. Two read-only agents swept them, and I spot-checked every file they cited (all exist, line counts match). Nothing in them was edited or run.

| Name in VALUES | Path used | Remote |
|---|---|---|
| reckoner | `C:\dev\ai-cost-estimator` | breakmylegs/reckoner |
| estimatrix | `C:\dev\estimatrix` | breakmylegs/estimatrix |
| brightline | `C:\dev\brightline` | breakmylegs/brightline |
| clauseworks | `C:\dev\clauseworks` | breakmylegs/clauseworks |
| proscenia | `C:\dev\Proscenia` | breakmylegs/nhs111-platform |
| peter | `C:\dev\peter` | breakmylegs/peter |
| muster | `C:\dev\muster` | breakmylegs/muster |
| shared | not found | none |

## Reuse rule I am following

Patterns, shapes and conventions only. **No code copied verbatim from any sibling repo.** All seven are on your personal GitHub, but my notes say most were built for work or for clients (ClauseWorks is the HSBC instance, Proscenia holds the NHS 111 and Lloyds demos). Until you name the repos you personally own, I treat all of them as not copyable. Every line in this project will be written fresh in its own stack.

## Which sibling is closest

- **Proscenia** is the nearest stack: Fastify 5, TypeScript, Postgres, a worker, and the external `proxy_net`. Most app-layer patterns come from here.
- **Muster** has the strongest `update.sh` and the best tests of it.
- **Peter** has the best Postgres session model (no Redis), which suits a home server.
- **Brightline** has the strongest AI gateway.
- **Reckoner** has the cleanest admin section list and release notes.

None of them use Drizzle, Zod 4, pg-boss, a PWA or a service worker, so those are fresh design.

## Patterns

### 1. Accounts, roles, invites, sessions, admin console

| Pattern | Where | Reuse | Change and why |
|---|---|---|---|
| Closed capability list, roles map to capabilities | Proscenia `api/src/auth/rbac.ts:3-173` | A closed `CAPABILITIES` list in `packages/schemas`, four built-in roles (owner, parent, carer, child profile) plus the kiosk and MCP token scopes. Every new capability must be placed in a role on purpose | Roles are fixed in V1, not editable. Re-asserted from code on every boot as Proscenia does |
| Default-deny hook on the root instance | Proscenia `auth/pending.ts:30-107` | An `onRequest` hook with an allowlist, so a route added later is covered by default | Proscenia uses it for a pending role. Here it guards every route by audience (parent, kiosk, MCP) |
| Never lose the last owner | Proscenia `auth/lastOwner.ts:1-87`, Reckoner `backend/app/rbac.py` | Every path that can remove an owner goes through one check (delete, deactivate, role change) | The brief asks for this at **database level**, which no sibling does. I will add a Postgres trigger as well as the code check |
| Sessions in Postgres | Peter `server/src/store.ts:245-300`, `authz.ts:18-50` | Session table with absolute and idle expiry, `HttpOnly`, `SameSite=Lax`, `Secure` | **Hash the session id at rest** (no sibling does). `Secure` always on, because Caddy terminates TLS and dev runs over https too |
| Session rotation on privilege change | Peter `routes/auth.ts:115-150`, test `__tests__/sessionRotation.test.ts` | New id on sign-in and on role change; old id revoked after the new one exists | Same |
| CSRF by JSON-only bodies plus a token | Proscenia root `application/json` parser; Peter double-submit `authz.ts:89-100` | Only JSON is parsed at the root, so a cross-site form post cannot reach a route. Also double-submit token on every state-changing request, including bodyless posts | Use `timingSafeEqual` for the token compare (Peter's compare is not constant-time) |
| Invites | Peter `server/src/inviteList.ts` (pasted list parser) | Little. No sibling has single-use invite links | **Fresh design.** Single-use, expiring invite link and QR code, redeemed by registering a passkey. No email |
| Admin console sections | Reckoner `frontend/src/admin/sections.ts:13-56` | Fixed section list, every section shows with an honest empty state, a test pins frontend and backend lists together | Section names follow the brief's Settings and System screens, not the estate's ten |

### 2. SAML, SCIM, SSO enforcement, maintenance and recovery CLI

| Pattern | Where | Reuse | Change and why |
|---|---|---|---|
| Recovery and maintenance CLI | Proscenia `api/src/maintenance/cli.ts:1-170`, `mode.ts:45-130`; Reckoner `maintenance.py` CLI-context gate | CLI only, never an HTTP route. Absolute expiry checked on read, 30-minute default. Prints the secret once to stdout. A test proves the CLI module does not import Fastify | Here the CLI issues a **one-time owner recovery link** that registers a new passkey, rather than a password. Maintenance mode is a separate CLI command that shows a banner and makes the API read-only |
| SSO is the only login | Proscenia `saml/status.ts:152-173` (cutover refused until one SSO login has succeeded) | The cutover rule: owner OIDC cannot be made the only owner login until one OIDC login has succeeded | Optional and owner-only. Passkeys stay as the main login for everyone. OIDC with `openid-client`, not SAML, as the brief says |
| Every URL from a configured base, never from the request | Proscenia `saml/sp.ts` | OIDC redirect URI and WebAuthn origin and RP ID come from config | Same, because the container sees `http://` behind Caddy |
| IdP claims never set roles | Proscenia, Brightline, Reckoner | OIDC only signs the owner in. Roles stay local | Same |
| SAML SP and SCIM | Proscenia `saml/`, `scim/` | Not needed in V1 | Out of scope. The brief asks for OIDC only. I will note the SCIM patterns (match order, adopt on PUT, empty `/Groups`) in an ADR for V2 |

### 3. AI provider connectors

| Pattern | Where | Reuse | Change and why |
|---|---|---|---|
| One gateway for every model call, cheapest checks first | Brightline `app/ai/__init__.py:79-165` | `packages/ai` exposes one `invoke(feature, ...)`. Order: feature registered, global switch, feature switch, data level allowed for provider, model allowlist, monthly cap. Failures return a typed result, never throw | Built on AI SDK 7 instead of boto3 |
| Closed list of purposes, new ones start off | Brightline `app/ai/purposes.py` | The feature registry from Part 13. A new feature ships switched off | Each entry also declares data level, propose or read, fallback and monthly cap |
| Audit every call | Brightline `app/ai/audit.py:1-60` | `ai.invoke`, `ai.refused`, `ai.config_change` (secrets redacted), `ai.cap_hit`. Prompt and response text not stored by default | Adds provider, model, tokens, **estimated cost** and data levels sent |
| Bedrock | Brightline `app/aws.py:665-730`, Proscenia `ai/credentials.ts:59-80` | Converse by default, guardrail only when configured, refuse long-lived access keys without a session token | Through `@ai-sdk/amazon-bedrock`. My notes record two Bedrock traps (Converse is not the Messages API; use `eu.anthropic.*` inference profiles). Both go in an ADR |
| Keys encrypted, write-only | Proscenia `crypto.ts:1-44` (AES-256-GCM), Brightline `settings_store.py:680-792` (last four only) | AES-256-GCM, last four characters shown, empty field means unchanged | Proscenia boots with an insecure default key and a warning. **This project fails closed**: no master key secret, no AI |
| Cost tracking and spend caps in money | none | Nothing | **Fresh design.** Caps in the siblings count calls. Here caps are in pence per feature per month, from a price table the owner can edit |
| Provider registry beyond Anthropic and Bedrock | none | Nothing | **Fresh design.** Six providers. Google enforced to the paid tier in code |

### 4. Deploy contract: `update.sh`

Strongest: **Muster `scripts/update.sh`** (894 lines, 38 tests in `tests/test_deploy_script.py`), with locking from ClauseWorks `scripts/update.sh:92-141` and post-deploy rollback from Proscenia `scripts/rollback.sh`.

| Reuse | Where | Change and why |
|---|---|---|
| Fixed phases with a distinct exit code per failure, printed table | Muster `update.sh:84-99` | Same shape, fewer phases (no pytest stage) |
| Atomic `mkdir` lock with an owner file, set before any trap, no stale-lock auto-clear | ClauseWorks `update.sh:92-141`, Muster `:145-205` | Same |
| `trap on_exit EXIT` plus `trap 'exit 130' INT` and `trap 'exit 143' TERM`, never `trap ... EXIT INT TERM` | All repos; reason in Reckoner `update.sh:354-360` | Same. A returning signal trap lets the script carry on past Ctrl-C with no lock held |
| Stamp commit and build time into the image, read them back after start, mismatch is a hard fail | Muster `:762-800`, Proscenia `docker/api.Dockerfile:15-28` | Same, through `/version` |
| Health gate where "no healthcheck" is a warning, never a pass | Muster `:727-760` | Same, gating on `/readyz` |
| Rollback image kept by tag so a rebuild cannot orphan it | Muster `:483-502` | **Changed:** the brief wants images tagged by commit. I will tag `family-time-api:<sha>` and record the previous sha in a state file. Rollback is `compose up` with the previous sha. No sibling tags by commit |
| Image-only automatic rollback, migrations forward-only | ClauseWorks `:143-160`, Proscenia `rollback.sh` | Automatic rollback swaps images only. It works because every migration is additive, so the previous image runs on the new schema. A test applies each migration and starts the previous image against it |
| Re-exec the freshly pulled script, log every run to a file | Reckoner `update.sh:157-165` | Same |
| Refuse a detached HEAD | Proscenia `update.sh:210-222` | Same |
| Build a shared image from one service only | Proscenia `docker-compose.yml:237-243` (three services building one tag deadlocked BuildKit) | api and worker share one image, built once |
| Script tests with shimmed docker and git | Muster `scripts/verify-deploy.sh`, Reckoner `scripts/lib/prove-deploy.sh` | Same harness style for `update.sh`, `backup.sh` and `restore.sh`. Plus the forced-failure rollback proof the brief asks for |

### 5. Backup and disaster recovery

| Reuse | Where | Change and why |
|---|---|---|
| Restore drill into scratch, never into live; verify size, header, tables, row counts, highest migration | Brightline `app/restore.py:170-284` (SQLite) | Same checks for Postgres: `pg_restore` into a scratch Compose project, then row counts and the latest Drizzle migration id |
| Integrity check before rotating old copies | Estimatrix `app/cli.py:100-145` | Same: rotate only after the new snapshot passes `restic check` and the size floor |
| Dump size floor, failed partial deleted | Proscenia `update.sh:519-545`, ClauseWorks `:574-600` | Same, but a nightly backup failure is a **push to parents**, not a warning |
| Private staging dir, cleanup trap, keep 7 locally | Muster `scripts/backup-offsite.sh:1-54` | restic retention policy instead of `--keep` |
| Client-side encryption, Besu volume snapshot, key backups | none | **Fresh design.** restic encrypts client-side. Besu stops briefly for the snapshot. Keys go to a separate restic repo with its own password |

### 6. Health, readiness, version, logging

| Reuse | Where | Change and why |
|---|---|---|
| `/healthz` touches nothing, registered before every guard, never rate-limited | ClauseWorks `server/src/health.ts:1-80`, `index.ts:106-124` | Same |
| `/readyz` checks hard dependencies, each with a timeout, 503 when not ready | ClauseWorks `health.ts`, Proscenia `api/src/health.ts:40-46` | Checks: Postgres, AdGuard API, worker heartbeat, Besu when the profile is on |
| `/version` with commit, build time, schema version read once at boot | Proscenia `health.ts:59-92` | Adds the Drizzle migration id as schema version |
| Structured JSON logs with request id and redaction; health probes at debug, not dropped | Proscenia `api/src/logging.ts:72-121` | Fastify's built-in pino logger with the same redaction list. Health probes at debug |

### 7. Caddy, Compose, systemd, multi-arch

| Reuse | Where | Change and why |
|---|---|---|
| External proxy network, internal network for the database, no published host ports | Proscenia `docker-compose.yml:14-16` | Same, except AdGuard publishes port 53 on the LAN address only, and the kiosk port on the LAN address only |
| `depends_on: service_healthy`, one-shot `migrate` service, optional parts behind `profiles` | Proscenia `docker-compose.yml:226-255` | Profiles `ledger-besu` and `ai-local` |
| `cap_drop: ALL`, `no-new-privileges`, secrets mounted read-only, `*_FILE` variables | Reckoner `docker-compose.yml:44-95` | Same. Docker secrets files from `init.sh` |
| Caddy site block with `encode`, `-Server`, forwarded proto | Muster `deploy/caddy/muster.caddy` | **Changed:** the siblings sit behind an AWS ALB with `auto_https off` on :8080. Your home Caddy terminates TLS itself, so the snippet uses normal automatic HTTPS. Adds `flush_interval -1` for SSE |
| Cron health watcher that restarts an unhealthy container, skips during deploy, gives up after 3 restarts in 12 hours | Estimatrix `scripts/health-watch.sh` | Same idea, as a systemd timer instead of cron |
| Memory limits, multi-arch buildx, systemd unit, log rotation | none | **Fresh design** |

### 8. Secrets and first boot

| Reuse | Where | Change and why |
|---|---|---|
| Read `NAME_FILE` first; an unreadable file is an error, not empty | ClauseWorks `server/src/secrets.ts:26-60`, Reckoner `statefile.py:79-127` | Same |
| Write secrets via temp file, mode 0600, rename; directories 0700 | Reckoner `statefile.py` | Same in `init.sh` |
| Drop to a non-root user after chowning the volume | Reckoner `docker/entrypoint.sh:19-56` | Same |
| One script that creates every secret and prints the owner invite | none | **Fresh design:** `scripts/init.sh` |

Your notes also say no setting may have to live in `.env`. That fits here: `init.sh` writes secrets files, and everything else is set in the app.

### 9. System page, audit log, release notes, retention, export

| Reuse | Where | Change and why |
|---|---|---|
| System page: build, uptime, each dependency check saying what it does not prove, jobs read from the same declarations the code runs | Proscenia `system/routes.ts:36-109` | Same, plus reconciler health, last backup and feature flags |
| Audit table: actor is a user id or a system label (CHECK exactly one), target type and id, JSON detail, indexes | Muster `app/migrations/0001_identity.sql:205-235` | Adds `before` and `after` as the brief asks. **Append-only enforced in the database** with a trigger, which no sibling does |
| Audit writer never throws into the request | Proscenia `audit.ts:5-49` | Same |
| Audit viewer with filters and export | Proscenia `admin/routes.ts:985-1060` | Use Peter's CSV formula-injection guard (`routes/settingsAudit.ts:219`), which Proscenia lacks |
| Release notes as a curated list, one plain line per version | Reckoner `backend/app/releases.py` | Parsed from `CHANGELOG.md` at build, as the brief says |
| Retention: zero means keep forever, first run deletes nothing, a never-pruned list with reasons, the sweep audits itself | Proscenia `retention/policy.ts:1-99` | Same, with the brief's periods (photos 30 days after approval, query aggregates, sessions, metrics) |
| Export lists what it leaves out and why | Peter `routes/dataExport.ts:1-60` | Same, documented JSON |

### 10. Rate limiting and trusted proxy

| Reuse | Where | Change and why |
|---|---|---|
| `trustProxy` as a function of hop count, never `true`, never a number | Proscenia `server.ts:66-124` (a number silently stops working on Fastify 5.12) | Same, one hop (Caddy) |
| Limiter proven by driving real requests to a 429 | Proscenia `saml/verifyHttp.ts:42-132` (a limiter that never ran for weeks) | Same, for every auth route |
| Backoff keyed on address and account together | Peter `loginBackoff.ts` | Same for passkey and recovery routes |

### 11. Verification script

No sibling has a probe of a running app; their "verify" scripts test `update.sh` against shims. The nearest is ClauseWorks `scripts/probe-live-bundles.mjs`: exit 0 clean, 1 finding, 2 unreachable, and unreachable is never a pass. **`scripts/verify.sh` is fresh design** on that exit code rule. It checks `/healthz`, `/readyz`, `/version` against the expected commit, that the kiosk answers on the LAN, and that AdGuard admin, Besu RPC and Postgres do **not** answer from outside the Docker network.

## Nothing in the estate covers these

Drizzle migrations and the "never edit an applied migration" hook; pg-boss jobs; passkeys; invite links; PWA, service worker and Web Push; SSE; AdGuard; Besu, Foundry and viem; the control engine; the help panel system; AI spend in money; multi-arch builds; memory limits; systemd; restic; a live verify script. Each gets an ADR where the decision is hard to reverse.

## Conflicts I found

1. **No Docker, pnpm or Foundry on this machine.** This is a Windows work laptop without Docker. Phase 0's exit criteria (stack comes up healthy, `update.sh` rolls back on a forced failure) and the AdGuard contract tests need a Linux Docker host. See question 1.
2. **CI.** The brief says CI runs everything and nothing merges red. Your other projects have Actions switched off and use a local gate script. See question 2.
3. **Branches.** The brief says one branch per phase. Your standing rule elsewhere is push straight to main. For this project I will follow the brief (branch per phase, merged after your approval) unless you say otherwise.
4. **Preact.** The brief says Preact 10. Preact 11.0.2 is now the latest. I recommend pinning **10.29.8**: it is what the research assessed, and an old Fire WebView is the wrong place to take on a new major. I will look at 11 again in Phase 6.
5. **Allow "Until tomorrow" runs through bedtime.** In the mock, Allow Roblox "Until tomorrow, until 07:00 Tue" sits above bed in precedence (parent override beats schedule), so Roblox would work all night. The brief's precedence agrees, so this is not a bug in the mock, but it cuts against "protect sleep first". I recommend the Allow sheet keeps the four options but "Until tomorrow" ends at the next bedtime unless the parent turns on a separate "Through bedtime" switch. Your call.
6. **"Count it in his weekly time" defaults to off.** In the mock, an Allow is extra time by default. The help topic for Allow, Block and Normal warns against allowing extra time most days. I recommend default **on**, so extra time is a deliberate choice. Your call.
7. **Kiosk progress bar.** The kiosk "Right now" card shows a draining bar for the current session. The brief says no countdown anxiety. I will keep it as shown, because it shows time used rather than counting down, and I will check it in the Phase 6 UX review.
8. **gitleaks.** Your global instructions ban it. Secret scanning will be a small script in the repo.

Versions checked on npm today, all consistent with Part 17 except Preact: ai 7.0.153, @ai-sdk/mcp 2.0.84, @modelcontextprotocol/server and client 2.4.0, Fastify 5.12.7, Zod 4.6.7, drizzle-orm 0.45.4 with drizzle-kit 0.31.11, pg-boss 12.38.0, Vite 8.3.5, Tailwind 4.3.3, Vitest 5.0.5, vite-plugin-pwa 2.0.0 (supports Vite 8, so injectManifest mode is fine), React 19.3.1, @simplewebauthn/server 14.0.3, openid-client 6.8.8, web-push 3.6.7, viem 2.57.11, Playwright 1.64.1, Turborepo 2.11.10, pnpm 12.15.0, OpenZeppelin Contracts 5.6.1, fast-check 4.10.2. AdGuard Home and Besu image tags (and Besu arm64) get checked when Docker is available. All pinned in `docs/versions.md` in Phase 0.

## Open questions

1. **Where do I build and test containers?** Options: Docker Desktop on this laptop if your employer allows it; a dev Linux VM on the Proxmox host that I reach over SSH; or GitHub Actions. I recommend a dev VM on Proxmox, the same machine type as production.
2. **CI: GitHub Actions or a local gate script?** I recommend a local `scripts/gate.sh` that runs everything, as in your other projects, and Actions only if you want them here.
3. **GitHub repo.** There is no remote yet. Name and visibility? I suggest `breakmylegs/family-time`, private.
4. **Which sibling repos do you personally own**, if any, so I know where copying code would be allowed? Until you say, I copy nothing.
5. **Work laptop.** This session runs on an employer laptop, and V2 is a public release. You may want to check that building a personal product on this machine does not give your employer a claim on it. If so, the build could move to the dev VM.
6. **VALUES still placeholders**, defaults used: `PUBLIC_HOSTNAME` (needs your domain), `KIOSK_LAN_URL` (server LAN IP and port), `CHILD_NAME` (the mock's "Ollie" until then; it is stored data, not code), `SCHEDULE_WEEKEND` (I will seed free from 08:00, wind-down 20:00, bed 21:00 until you set it). `REMOTE_ACCESS` caddy-public and `OWNER_SSO` none as given.
7. **Mock questions 5 and 6 above**: "Until tomorrow" through bedtime, and the default for "Count it in his weekly time".
8. **Kiosk statics.** I plan for the api to serve the parent and kiosk builds (one image, one origin for cookies and SSE, the kiosk on a second LAN-only listener). Separate static containers add little at home. I will write this up as an ADR in Phase 0.
9. **Skills.** The brief asks me to install Emil Kowalski's skills with `npx skills@latest`. Impeccable is already available in this environment. OK to install Emil's into the project in Phase 0?
