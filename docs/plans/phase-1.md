# Phase 1 plan: accounts and roles

Branch `phase-1`. The owner said to carry on building and deploy to the server later, so this plan is recorded and the build starts straight away. Nothing here touches your network.

## Goal

People sign in with a passkey (Face ID on an iPhone), are invited by link, and have a role. The owner can get back in from the server's command line. Every privileged action is audited.

## Exit criteria

1. Here: Playwright drives the whole flow in Chromium with a virtual authenticator. The owner invite is redeemed with a passkey, the owner invites a parent, the parent joins with their own passkey, and both sign out and back in. Role tests pass, and the last owner cannot be removed even with raw SQL.
2. On the server, later: you and Mum sign in with Face ID on your iPhones.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Only the account tables now: households, people, passkeys, sessions, invites, WebAuthn challenges, recovery links, settings, audit events. The rest of the Part 3 model comes in the phase that first uses it, as new additive migrations | Tables nothing reads are untested guesses. Additive migrations mean V1 data still upgrades without a rebuild |
| 2 | Passkeys are discoverable (stored on the phone) and need user verification, so sign-in is one tap and Face ID, with no email or username | Mum signs in one-handed |
| 3 | The first owner comes from the command line: `./scripts/ft.sh owner-invite --origin https://family.<domain>`. It refuses once an owner exists. The origin is stored in settings, not in `.env` | Nothing has to live in `.env`. The passkey's relying party is the hostname, so it must be set before the first passkey |
| 4 | Recovery: `./scripts/ft.sh recovery-link` prints a one-time link, valid 30 minutes, that lets the owner add a new passkey. Old passkeys stay | Matches the sibling apps' break-glass CLI. Works with no email |
| 5 | Sessions: random id, stored only as a SHA-256 hash, `__Host-` cookie (HttpOnly, Secure, SameSite=Lax), 30 days idle and 180 days absolute, a new id on every sign-in, all of a person's sessions revoked when their role changes or they are removed | Long enough that Mum is not asked to sign in at teatime. The hash means a database leak gives no sessions |
| 6 | CSRF: double-submit token on every state-changing request, bodyless ones included, plus an Origin check against the stored origin | The JSON-only parser already blocks form posts. Bodyless posts are the hole the sibling apps found |
| 7 | Every route declares who may call it. A route with no declaration stops the server from starting | Default deny that a later phase cannot forget |
| 8 | Roles map to a closed list of capabilities. Owner has all. Carer can view, pause and approve within the plan, nothing else | Brief Part 8 |
| 9 | Database triggers: the last active owner cannot be deleted, demoted or deactivated, and audit events can never be updated or deleted | The brief asks for database-level protection. No sibling app had it |
| 10 | Rate limits on auth routes, in memory, keyed on the real client address. Proven by driving requests to a 429 | One api process at home; Redis would add a container for nothing |
| 11 | A minimal parent app now: sign in, join from an invite, recover, a signed-in home, and People (invite and remove). React 19, Vite 8, Tailwind 4, tokens from the mock. The full Control screen is Phase 3 | The Phase 1 exit needs a screen to sign in on |
| 12 | The api serves the parent build itself (ADR 0003), with a small static handler instead of a new dependency | |
| 13 | Optional owner OIDC is DEFERRED (built in Phase 10, tested against a fake provider: ADR 0019). `OWNER_SSO` is `none`, so nothing uses it, and there is no Authentik here to test against. It comes back when you switch it on. The `people.oidc_subject` column is already there for it | Untested sign-in code is worse than none. Brief Part 8 lists it as optional |
| 14 | Invite QR codes wait for Phase 3. A QR library is not in Part 17, and the link works now | Avoids a dependency for a convenience |

## Dependencies

All in Part 17: `@simplewebauthn/server` 14.0.3, `@simplewebauthn/browser` 14.0.0, `openid-client` 6.8.8, `react` and `react-dom` 19.3.1, `vite` 8.3.5, `tailwindcss` 4.3.3, `@playwright/test` 1.64.1, `fast-check` 4.10.2. Plus each tool's own companion: `@vitejs/plugin-react` 6.1.2, `@tailwindcss/vite` 4.3.3, `@types/react` and `@types/react-dom` 19.3.0.

## Files

- `packages/db`: schema for the tables above, migration `0001_accounts`, triggers in the same migration.
- `packages/schemas`: Zod shapes for every auth request and response.
- `apps/api/src/auth/`: capabilities and roles, sessions, CSRF, the access hook, rate limit, passkeys, invites, recovery, OIDC.
- `apps/api/src/routes/`: `/api/auth/*`, `/api/people/*`, `/api/me`.
- `apps/api/src/cli.ts` and `scripts/ft.sh`: `owner-invite`, `recovery-link`.
- `apps/api/src/static.ts`: serves `apps/parent/dist`.
- `apps/parent`: the screens above.
- `packages/tokens`: colour, type and spacing tokens from the mock, light and dark.
- `e2e/`: Playwright tests with a virtual authenticator.
- `docs/adr/0007` sessions and CSRF, `0008` default-deny routes.
