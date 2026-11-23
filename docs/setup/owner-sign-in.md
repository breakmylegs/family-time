# Owner sign-in through your sign-in service (optional)

For the owner. Passkeys are the main way in and keep working whatever you do here. If you already run a sign-in service for your other apps, such as **Authelia** or **Authentik**, you can also sign in to Family time with it. It is standard OpenID Connect, so any provider that speaks it should work; these two are the ones written up. Only an owner can, and only once they have linked their account from Settings.

## How Family time asks

- The authorisation code flow with PKCE (S256), state and nonce. Scopes `openid` and `profile`.
- The client authenticates with **`client_secret_basic`**: the client secret in the Authorization header.
- ID tokens signed with **RS256**, checked against the provider's published keys.
- The redirect URI is your public address followed by `/api/auth/oidc/callback`, for example `https://family.example.com/api/auth/oidc/callback`.
- **Every sign-in asks for a fresh login** (`prompt=login`, `max_age=0`), and the ID token's `auth_time` must be within the last five minutes. A session your sign-in service already has in a shared tablet's browser must never become an owner session by itself. See [If it says the sign-in wasn't fresh](#if-it-says-the-sign-in-wasnt-fresh).
- Your account is linked by the provider's `sub` (subject) together with its issuer, never a username or email, which can change.

## Authelia

The issuer is Authelia's root address, for example `https://auth.example.com`. Authelia's `sub` is a random UUID it keeps for each user, which is what Family time links to; leave `sector_identifier_uri` unset for this client so it stays the same.

1. Make the client secret and its digest, on the machine that runs Authelia:

   ```bash
   docker run --rm authelia/authelia:latest authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986
   ```

   It prints the random secret and its digest. The digest goes in Authelia's configuration; the secret itself goes only into Family time's `secrets/oidc_client_secret` (below).

2. Add the client to Authelia's configuration:

   ```yaml
   identity_providers:
     oidc:
       clients:
         - client_id: 'family-time'
           client_name: 'Family time'
           client_secret: '$pbkdf2-sha512$310000$...'   # the digest from step 1, never the secret itself
           public: false
           authorization_policy: 'two_factor'
           require_pkce: true
           pkce_challenge_method: 'S256'
           redirect_uris:
             - 'https://family.example.com/api/auth/oidc/callback'
           scopes: ['openid', 'profile']
           response_types: ['code']
           grant_types: ['authorization_code']
           token_endpoint_auth_method: 'client_secret_basic'
           id_token_signed_response_alg: 'RS256'
   ```

   Restart Authelia, and check its log has no warnings about the client.

3. On the Family time server:

   ```bash
   cd /opt/family-time
   ./scripts/ft.sh sso-setup --issuer https://auth.example.com --client-id family-time --name "Authelia"
   nano secrets/oidc_client_secret        # paste the secret from step 1 (not the digest), save
   chmod 600 secrets/oidc_client_secret
   ./scripts/update.sh
   ```

## Authentik

1. Create an OAuth2/OpenID provider for Family time: client type Confidential, signing key your usual one (RS256), scopes `openid` and `profile`. Leave Subject mode on Based on the User's hashed ID (or UUID), never username or email, which people can change.
2. Set the redirect URI to your public address followed by `/api/auth/oidc/callback`. Strict, not a pattern.
3. Create an application that uses the provider, and limit it to your own Authentik account.
4. Note the provider's client ID, client secret, and OpenID Configuration Issuer.
5. On the Family time server:

   ```bash
   cd /opt/family-time
   ./scripts/ft.sh sso-setup --issuer https://auth.example.com/application/o/family-time/ --client-id THE_CLIENT_ID --name "Authentik"
   nano secrets/oidc_client_secret        # paste the client secret, save
   chmod 600 secrets/oidc_client_secret
   ./scripts/update.sh
   ```

`sso-setup` prints the redirect URI Family time will use: check it matches the one in your sign-in service exactly. `--name` is what the app calls it ("Sign in with Authelia"); without it, the app says "your sign-in service". You can change only the name later with `./scripts/ft.sh sso-setup --name "..."`, which keeps every link. The client secret goes in a file only root can read, never on the command line.

## Link your account

1. Sign in with your passkey, open Settings, and tap Link next to Sign in with (your service).
2. Sign in to your service when it asks. It should always ask, even if you are already signed in there in that browser. You come back to Settings, which says Linked.

From then on the sign-in screen shows Sign in with (your service) as well as Sign in.

## If it says the sign-in wasn't fresh

Family time asks for a fresh login every time, and refuses a sign-in more than five minutes old. If your service hands back an existing session instead of asking you to sign in again, Family time says so ("didn't ask you to sign in again") rather than failing over and over. Then:

- Sign out of your sign-in service in that browser (for Authelia, open its address and choose Log out), and try again.
- Check its version is current: support for `prompt=login` and `max_age` varies between providers and versions, and Authelia's documentation does not promise either. A newer release may ask again as it should.
- Until then, sign in with your passkey, which always works.

## Not in front of Caddy's forward_auth

Do **not** put Authelia's (or Authentik's) `forward_auth` in front of the Family time site in Caddy. Family time does its own sign-in, and a gateway in front of it breaks things that must reach it directly:

- invite links and passkey sign-up, opened on a phone that has never signed in to your service
- `/api/events`, the live updates every screen keeps open
- web push, and the service worker that receives it
- `/mcp` and the connected-app sign-in, which use their own tokens
- `/healthz` and the other checks `./scripts/verify.sh --url` makes

Use `deploy/caddy/family-time.caddy` as it is. Owner sign-in through your service happens inside the app, as above.

## Switch it off

```bash
./scripts/ft.sh sso-setup --off
```

That also unlinks every owner and signs them out everywhere; they sign in with their passkey again. Or tap Unlink in Settings to stop your own account using it, which also signs you out on your other devices. Emptying `secrets/oidc_client_secret` and running `./scripts/update.sh` turns it off for everyone.
