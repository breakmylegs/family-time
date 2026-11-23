# ADR 0023: Owner sign-in through any OpenID Connect provider

Status: accepted, 23 November 2026. Amends [ADR 0019](0019-owner-sign-in-with-authentik.md).

## Context

The pilot household runs Authelia, not Authentik. ADR 0019's flow is standard OpenID Connect, but the app, the command line, the audit labels and the docs all said "Authentik".

## Decision

- **Neutral, with a name the owner sets.** `ft.sh sso-setup --name "Authelia"` stores a display name in the existing `owner_sso` setting; the app says "Sign in with Authelia". Without a name it says "your sign-in service". Settings from before keep working, and changing only the name keeps every link. The sign-in state (`/api/auth/state`) and `/api/auth/oidc` carry the name.
- **The flow is unchanged**: authorisation code with PKCE (S256), state and nonce, scopes `openid profile`, RS256 ID tokens checked against the provider's keys, `prompt=login`, `max_age=0`, and `auth_time` within five minutes. The client now says outright that it authenticates with `client_secret_basic`, so the provider's client can be set to match (Authelia's `token_endpoint_auth_method: client_secret_basic`).
- **A sign-in that is not fresh is its own outcome.** Authelia's documentation promises `auth_time` in ID tokens, but neither `prompt=login` nor `max_age`. If a provider hands back an existing session, the old or missing `auth_time` is refused as before, and the owner now sees "didn't ask you to sign in again" with what to do (sign out of the service, update it, or use the passkey), on the sign-in screen or in Settings when linking. Before, it was the same "try again" as any other failure, which would fail the same way every time.
- **Links are unchanged**: `people.oidc_subject` is the issuer and `sub` together. Authelia's `sub` is a UUID v4 it keeps per user, the same for every client unless `sector_identifier_uri` is set, so the docs say to leave that unset.
- **Audit records are neutral**: a sign-in records `with: oidc` and the provider's name; the System page's labels say "sign-in service".
- **No forward_auth in front of the site.** The setup docs and the Caddy snippet warn against putting Authelia's or Authentik's `forward_auth` in front of Family time, which does its own sign-in: it would break invite links, passkey sign-up, `/api/events`, push and `/mcp`.

## Consequences

- `docs/setup/authentik.md` is now `docs/setup/owner-sign-in.md`, with an Authelia section (an `identity_providers.oidc.clients` example, the secret digest command) and an Authentik section.
- Whether Authelia asks again on `prompt=login` is for the pilot to find out; if it does not, owners see the clear message and use their passkey.
