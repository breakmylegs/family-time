# Signing in with Authentik (optional)

For the owner. Passkeys are the main way in and keep working whatever you do here. If you already run Authentik for your other apps, you can also sign in to Family time with it. Only an owner can, and only once they have linked their Authentik account from Settings.

## In Authentik

1. Create an OAuth2/OpenID provider for Family time: client type Confidential, signing key your usual one, scopes `openid` and `profile`. Leave Subject mode on Based on the User's hashed ID (or UUID), never username or email, which people can change.
2. Set the redirect URI to your public address followed by `/api/auth/oidc/callback`, for example `https://family.example.com/api/auth/oidc/callback`. Strict, not a pattern.
3. Create an application that uses the provider, and limit it to your own Authentik account.
4. Note the provider's client ID, client secret, and OpenID Configuration Issuer.

## On the server

```bash
cd /opt/family-time
./scripts/ft.sh sso-setup --issuer https://auth.example.com/application/o/family-time/ --client-id THE_CLIENT_ID
# The secret goes in a file that only root can read, never on the command line:
nano secrets/oidc_client_secret        # paste the client secret, save
chmod 600 secrets/oidc_client_secret
./scripts/update.sh
```

`sso-setup` prints the redirect URI Family time will use: check it matches the one in Authentik exactly.

## Link your account

1. Sign in with your passkey, open Settings, and tap Link next to Sign in with Authentik.
2. Sign in to Authentik when it asks. It always asks, even if you are already signed in to Authentik in that browser, so a shared tablet never signs anyone in as you. You come back to Settings, which says Linked.

From then on the sign-in screen shows Sign in with Authentik as well as Sign in.

## Switch it off

```bash
./scripts/ft.sh sso-setup --off
```

That also unlinks every owner and signs them out everywhere; they sign in with their passkey again. Or tap Unlink in Settings to stop your own account using it, which also signs you out on your other devices. Emptying `secrets/oidc_client_secret` and running `./scripts/update.sh` turns it off for everyone.
