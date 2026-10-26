# Server setup

For the owner. Run these on the Proxmox VM (Ubuntu 24.04), as root (`sudo su -`). Nothing here touches your router or DNS. AdGuard is added in Phase 2, and it is not pointed at anything until you say so.

## What you need first

- An Ubuntu 24.04 VM. Not Docker inside an unprivileged LXC.
- Docker Engine with the Compose plugin, from Docker's own apt repository (`docker compose version` must work).
- `git` and `openssl` (`apt install git openssl`).
- Your Caddy's Docker network. Check it exists: `docker network inspect proxy_net`. If your Caddy runs on another host, create it here (`docker network create proxy_net`) and tell me, because the Caddy snippet changes.
- A read-only access token for the GitHub repository (a fine-grained token with Contents: read on this one repository). The server clones over HTTPS, never SSH.

## First install

Clone the branch being tested. While a phase is under review that is its branch (now `phase-0`); after you approve it, the server moves to `main` (below). Git asks for a username (your GitHub name) and a password (paste the token). `credential.helper=store` saves the token for this repository in root's `~/.git-credentials`, because `update.sh` pulls in the background, where nothing can type it.

```bash
git clone -b phase-0 -c credential.helper=store https://github.com/breakmylegs/family-time.git /opt/family-time
```

Create the secrets, then deploy. The first build takes several minutes. `update.sh` runs in the background, so a dropped SSH session does not stop it; it shows the log as it goes.

```bash
cd /opt/family-time && ./scripts/init.sh && ./scripts/update.sh
```

Paste me everything it printed. The last line says `finished: exit 0, deployed` when it worked.

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

## If something goes wrong

- Every run writes a log in `/opt/family-time/.deploy/logs/`. The newest one is the one to send me.
- `update.sh` refuses to start while another deploy holds `.deploy/lock`. If no deploy is running (for example after a reboot mid-deploy), read the newest log, then remove the lock with `rm -rf /opt/family-time/.deploy/lock`.
- Exit codes: 0 deployed. 10 to 17 stopped before or at migration, the running version is untouched. 21 the new version failed and the previous one is running again. 22 the rollback failed too and the site is down. 23 the first deploy failed.
- Before each migration, `update.sh` saves a database dump in `/opt/family-time/backups/pre-deploy/` (the newest ten are kept). Restoring one is a decision we make together.
