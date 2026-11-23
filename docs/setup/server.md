# Server setup

For the owner. Run these on the Proxmox VM (Ubuntu 24.04), as root (`sudo su -`). Nothing here touches your router or DNS.

## What you need first

- An Ubuntu 24.04 VM. Not Docker inside an unprivileged LXC.
- Docker Engine with the Compose plugin, from Docker's own apt repository (`docker compose version` must work).
- `git`, `openssl` and `curl` (`apt install git openssl curl`).
- Your AdGuard Home, if you have one already (the default, ADR 0022): its address as this VM reaches it, a user for Family time and its password, and version v0.107.79 or a later 0.107 release. [AdGuard and the home network](network.md) lists exactly what it needs. Without one, Family time can run its own: the bundled AdGuard.
- Your Caddy's Docker network. Check it exists: `docker network inspect proxy_net`. If your Caddy runs on another host, create it here (`docker network create proxy_net`) and tell me, because the Caddy snippet changes.
## First install

The repository is public, so the server clones and pulls over HTTPS with no token and no stored credentials. Clone `main`, or, to test a phase before it is merged, its branch (for example `phase-9`), and move to `main` afterwards (below).

```bash
git clone -b <branch> https://github.com/breakmylegs/family-time.git /opt/family-time
```

Create the secrets and choose your AdGuard. With your own AdGuard on the home network (the default):

```bash
cd /opt/family-time && ./scripts/init.sh --adguard external --adguard-url https://<adguard-address> --adguard-user familytime
```

It asks for that user's AdGuard password without showing it, then checks the VM can reach AdGuard, the login works and the version is supported. For an https AdGuard with a self-signed certificate, add `--adguard-ca /path/to/its.crt`. To have Family time run its own AdGuard instead: `./scripts/init.sh --adguard bundled`. Run without options, `init.sh` asks. Running it again is safe and keeps what is already set.

Then deploy. The first build takes several minutes. `update.sh` runs in the background, so a dropped SSH session does not stop it; it shows the whole build as it goes. With your own AdGuard, it checks AdGuard first and stops, saying why, if the VM cannot reach it, the login fails or the version is not supported.

```bash
cd /opt/family-time && ./scripts/update.sh
```

Paste me everything it printed. The last line says `finished: exit 0, deployed` when it worked.

## Set up AdGuard for Family time (once)

See what would change in AdGuard first; this changes nothing:

```bash
cd /opt/family-time && ./scripts/ft.sh adguard-setup
```

Then apply it with `--yes`, or, to leave your AdGuard's global settings as they are and let Family time manage only its own devices and rules block, add its two markers to AdGuard's custom rules and run `./scripts/ft.sh adguard-setup --family-time-only --yes`. [AdGuard and the home network](network.md) explains both, and how to point devices at AdGuard afterwards.

## Make the first owner (once)

Passkeys only work over HTTPS, so the parent app needs its Caddy site first. Add `deploy/caddy/family-time.caddy` to your Caddyfile with your hostname, and reload Caddy. Do not put Authelia's or Authentik's `forward_auth` in front of it: Family time does its own sign-in, and a gateway in front breaks invite links, passkey sign-up, live updates (`/api/events`), push and `/mcp`. To sign in through your sign-in service, see [Owner sign-in](owner-sign-in.md).

Then make the first owner's link. Use the exact address the app is reached at; passkeys are tied to it and it cannot be changed later.

```bash
cd /opt/family-time && ./scripts/ft.sh owner-invite --origin https://family.<your-domain> --name "<your name>" --family "<family name>"
```

Open the link it prints on your iPhone, in Safari, within 24 hours. Tap Make my passkey and use Face ID. Then, in the app, open People and invite Mum. Send her the link; she opens it on her iPhone and does the same.

## If you lose your phone

This prints a link, valid for 30 minutes, that lets you add a passkey on a new phone. Your old passkeys keep working until you remove them.

```bash
cd /opt/family-time && ./scripts/ft.sh recovery-link
```

## Prove the rollback (once, after the first deploy)

This builds a version that is never ready, deploys it, and checks that `update.sh` puts the working version back.

```bash
cd /opt/family-time && ./scripts/drill-rollback.sh
```

Paste me the results block. Every line should say PASS.

## Start at boot

```bash
cp /opt/family-time/deploy/systemd/family-time.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable family-time
```

Copy it again after an update that changes it (0.14.0 did): it starts the stack the same way `update.sh` does, so the bundled AdGuard starts at boot only when you chose it.

## Every later deploy

`update.sh` deploys the newest commit of whichever branch the server has checked out.

```bash
cd /opt/family-time && ./scripts/update.sh
```

## Moving to main after a phase is approved

Once a phase is merged, switch the server back to `main`, then deploy.

```bash
cd /opt/family-time && git checkout main && ./scripts/update.sh
```

## A server set up before the repository was public

Earlier instructions saved a read-only GitHub token in root's `~/.git-credentials`. It is no longer needed, and a revoked or expired one makes `update.sh`'s pull fail. Remove it, then revoke it on GitHub (Settings, Developer settings, Personal access tokens):

```bash
sed -i '/github\.com/d' /root/.git-credentials; git -C /opt/family-time config --unset credential.helper
```

## If something goes wrong

- Every run writes a log in `/opt/family-time/.deploy/logs/`. The newest one is the one to send me.
- `update.sh` refuses to start while another deploy holds `.deploy/lock`. If no deploy is running (for example after a reboot mid-deploy), read the newest log, then remove the lock with `rm -rf /opt/family-time/.deploy/lock`.
- Exit code 10 with an AdGuard message means the check of your AdGuard failed before anything was built. The message says what to fix; [AdGuard and the home network](network.md) has the details.
- Exit codes: 0 deployed. 10 to 17 stopped before or at migration, the running version is untouched. 21 the new version failed and the previous one is running again. 22 the rollback failed too and the site is down. 23 the first deploy failed.
- Before each migration, `update.sh` saves a database dump in `/opt/family-time/backups/pre-deploy/` (the newest ten are kept). Restoring one is a decision we make together.
