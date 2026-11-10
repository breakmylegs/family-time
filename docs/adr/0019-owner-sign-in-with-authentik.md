# ADR 0019: Owner sign-in with Authentik

Status: accepted, 9 November 2026 (Phase 10)

## Decision

- Optional, owner only, beside passkeys, never instead of them (brief Part 8). `openid-client` 6.8.8 (brief Part 17) runs the authorisation code flow with PKCE, state and nonce. Every request asks Authentik for a fresh sign-in (`prompt=login`, `max_age=0`, and the ID token's `auth_time` must be within five minutes): the passkey asks for Face ID every time, and a live Authentik session on a shared family tablet must never become an owner session by itself. The ID token's signature is checked against the issuer's published keys (`enableNonRepudiationChecks`), not only trusted because it arrived over TLS.
- Set up by `./scripts/ft.sh sso-setup --issuer https://... --client-id ...` (a household setting, https only) and the client secret in `secrets/oidc_client_secret` (read through `OIDC_CLIENT_SECRET_FILE`; empty means off). `init.sh` and `update.sh` create the file empty, because Compose needs every secret file to exist.
- The pending state, nonce and PKCE verifier live in the api's memory for ten minutes, keyed by a random value in the `__Host-ft_oidc` cookie (HttpOnly, Secure, SameSite=Lax, so it comes back on Authentik's top-level redirect). Each is used once. The api runs as one process, so memory is enough; a restart in the middle of a sign-in means signing in again.
- Linking: an owner signed in with a passkey POSTs `/api/auth/oidc/link` (system.manage, CSRF token), goes to Authentik, and the callback, which must come back to the same signed-in owner, stores the issuer and the ID token's `sub` together in `people.oidc_subject`, which a database check already limits to owners and a unique index to one person. Making an owner a parent or removing them clears it; changing the issuer, or `sso-setup --off`, clears every link and signs those owners out; unlinking signs that owner out on their other devices and works in maintenance mode. Signing in: `/api/auth/oidc/start`, then the callback finds the active owner with that subject and starts the same session as a passkey does.
- Every outcome is audited, with the Authentik username where there is one: linked, link refused, unlinked, signed in (with Authentik), not confirmed (with the reason), not linked here. A callback with no sign-in started in that browser is logged, not audited, so it cannot fill the audit log. Sign-ins anyone can start never push a link in progress out of the bounded pending list.
- Tested against a fake provider in the api's tests that signs RS256 ID tokens and checks the PKCE verifier. The tests show a token signed with another key, for another audience, with a stale `auth_time` or a wrong nonce is refused, as are a code used twice, a code from another browser, and a link finished by someone else.
- The sign-in screen says whether an owner has linked Authentik, and `/start` sends the browser to Authentik's address with the client id. Both are what any sign-in button shows.

## Consequences

- The api calls Authentik over its egress network, at the issuer the owner set.
- Authentik's own session and its multi-factor rules then guard the owner account as well as the passkey. Losing Authentik never locks the owner out: passkeys and the recovery link are unchanged.
