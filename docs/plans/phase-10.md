# Phase 10 plan: owner sign-in through Authentik

Branch `phase-9` (continued). The last item of the brief left unbuilt: brief Part 8 and Phase 1 list optional owner sign-in through Authentik with OIDC (`openid-client`, in Part 17). Phase 1 deferred it because there was no Authentik to test against. It is now tested against a fake OpenID provider that signs real ID tokens.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The issuer and client id are a household setting (`ft.sh sso-setup`); the client secret is `secrets/oidc_client_secret`, read through `OIDC_CLIENT_SECRET_FILE`. Empty, as `init.sh` and `update.sh` leave it, means off | Only secrets are files; Compose needs the file to exist |
| 2 | Authorisation code flow with PKCE, state and nonce, kept on the server for ten minutes behind a random HttpOnly cookie, each used once | A code from another browser, or used twice, is refused |
| 3 | Only an owner can link, from Settings while signed in with a passkey, by a POST with the CSRF token. Only a linked, active owner can sign in this way; an unlinked Authentik account is refused | Brief Part 8: optional owner login. Linking is never started by a page elsewhere |
| 4 | The sign-in screen offers Authentik only once an owner has linked it | Nobody sees a button that cannot work |
| 5 | Issuers must be https | Tokens never cross the network in the clear |

## Still not built, with reasons

- The monthly wellbeing check: the child scale's licence is the owner's to confirm.
- Kiosk HTTPS on the LAN and router rules: the owner's network.
- On-chain contract changes from ADR 0014 (one household per child on chain, rate changes by the cold key or after a delay, the compiler pinned by checksum): the contract is compiled and tested only in the image build, never on the laptop, and a new contract means a redeploy and replay that is the owner's decision. Recorded for the next contract version.
