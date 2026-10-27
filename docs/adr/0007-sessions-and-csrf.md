# ADR 0007: Passkey sessions and CSRF

Status: accepted, 27 October 2026 (Phase 1)

## Decision

- Sign-in is a discoverable passkey with user verification: one tap, then Face ID or the passcode. No password exists anywhere.
- A session is a random 32-byte id in a `__Host-ft_session` cookie (HttpOnly, Secure, SameSite=Lax, Path=/). Only its SHA-256 is stored. A new id is issued at every sign-in. Sessions end after 30 idle days or 180 days in all, and all of a person's sessions end when their role changes or they are removed.
- CSRF: every state-changing request needs an `Origin` header equal to the stored public origin. A signed-in one also needs the `x-csrf-token` header to equal the `__Host-ft_csrf` cookie (double submit), bodyless requests included. Only JSON bodies are parsed.
- Invite and recovery links carry their token after `#`, so it never reaches a server log or a Referer header. Only a hash is stored. Join links last 7 days, the first owner's 24 hours, recovery links 30 minutes. Each works once.
- The public origin is set once, by `./scripts/ft.sh owner-invite --origin`, and stored in settings. Passkeys are bound to its hostname, so the CLI refuses to change it afterwards.

## Why

Mum signs in one-handed in the kitchen, so the session must last and signing in must be one tap. Hashing session ids and tokens means a copy of the database grants nothing. The `__Host-` prefix stops a subdomain setting either cookie. The Origin check covers sign-in requests, which have no session to carry a token.

## Consequences

- Changing the hostname later means everyone makes a new passkey from a fresh invite. That is a deliberate, rare operation, done with a new CLI command if it is ever needed.
- Development and the end-to-end tests run on `http://localhost`, which browsers treat as secure, so the same cookies work there.
