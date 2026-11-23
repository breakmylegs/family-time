# Family time: brief for the home lab

A self-contained description of Family time and what it needs from the home lab, for whoever (or whatever assistant) plans the lab around it. Addresses and names here are examples. Version 0.15.1, branch `phase-9`, repository `https://github.com/breakmylegs/family-time` (public).

## What it is

A self-hosted screen-time and rewards system for one family. Parents control which apps and sites each child's devices can reach, plan screen time in a weekly allowance, and reward jobs with pocket money, points or time. Children use a wall-mounted kiosk tablet to plan time, mark jobs done and ask for things.

- **Blocking is DNS-based.** Family time writes per-device clients and a block of custom rules into **AdGuard Home**. A child's device is blocked only while it uses that AdGuard for DNS, so blocking works on home Wi-Fi only; the device's own screen-time controls are the backstop elsewhere.
- **Parents** use a phone web app (installable PWA) over HTTPS, signing in with passkeys (Face ID). Optionally the owner can also sign in through the home's OpenID Connect provider (Authelia or Authentik).
- **Children** use the kiosk: a tablet (an Amazon Fire running Fully Kiosk Browser) on the LAN, plain http, no sign-in; a 4-digit PIN per child when siblings share it.
- **Nothing is cloud-hosted.** Optional extras: AI suggestions (a cloud provider, or a local Ollama), a private Besu blockchain copy of the points ledger, web push alerts to parents' phones.

## How it is built

One Docker Compose project, `family-time`, on an Ubuntu VM. Images are built on the server from the repository; there is no registry.

| Service | Image | Role | Networks | Memory limit |
|---|---|---|---|---|
| postgres | postgres:18.6-trixie | The database | internal | 512 MB |
| migrate | family-time (built) | One-off: database migrations, additive only | internal | 256 MB |
| api | family-time (built) | Web app and API (port 3000 inside), and the kiosk's own listener (3001 inside, published on `LAN_IP:8180`) | internal, egress, ai, proxy | 384 MB |
| worker | family-time (built) | Background jobs: the only writer to AdGuard, usage, alerts, backups' records, ledger | internal, egress, ledger | 256 MB |
| adguard | adguard/adguardhome:v0.107.79 | Only with the `adguard-bundled` profile: Family time's own AdGuard. Publishes `LAN_IP:53` | internal, egress | 256 MB |
| besu, besu-allowlist | hyperledger/besu:26.10.2 | Only with the `ledger-besu` profile: the optional blockchain ledger | ledger | 3 GB |
| ollama | ollama/ollama:0.40.15 | Only with the `ai-local` profile: local AI | ai (no route out) | 4 GB |

Networks: `internal`, `ledger` and `ai` have no route out. `egress` is the way out. `proxy` is an **external** Docker network the reverse proxy is on (default name `proxy_net`); only the api joins it, under the alias `family-time-api`.

Published ports: only `LAN_IP:8180` (the kiosk, http), plus `LAN_IP:53` tcp/udp when the bundled AdGuard is chosen. The api's port 3000 is never published; the reverse proxy reaches it over `proxy_net`.

Secrets are files in `/opt/family-time/secrets/` (root only, mode 0600), made by `scripts/init.sh` and mounted as Docker secrets. Never environment variables, never on a command line. Deploy state lives in `/opt/family-time/deploy/.state/` (`network.env`, `adguard.env`, `ledger.env`, `backup.env`, `image.env`).

## What the home lab must provide

### The VM

- Ubuntu 24.04 LTS on Proxmox, a full VM (not Docker in an unprivileged LXC).
- Docker Engine with the Compose v2 plugin, from Docker's own apt repository.
- `git`, `openssl`, `curl`, `restic` (`apt install git openssl curl restic`).
- Size: the stack runs in about 1.5 GB, but every deploy builds the images and runs the whole test suite on the server. Give it **4 vCPU, 8 GB RAM, 40 GB disk**. Add 3 GB for the Besu ledger and 4 GB or more for local AI if those are switched on.
- A fixed LAN address (DHCP reservation or static). It becomes `LAN_IP`.
- Outbound internet: GitHub (clone and pull, HTTPS, no credentials), Docker Hub (base images), the npm registry (during builds), the browsers' push services (Apple, Google, Mozilla, Microsoft), and AI providers only if switched on.

### Reverse proxy and HTTPS

- **Caddy in Docker on the same Docker host**, joined to the external network `proxy_net` (create it with `docker network create proxy_net` if it does not exist). If the proxy runs on another host, the setup changes: say so before installing.
- A public hostname with a valid certificate, for example `family.example.com`. Passkeys only work over HTTPS at a fixed origin, which cannot change later.
- The site block is `deploy/caddy/family-time.caddy`: `reverse_proxy family-time-api:3000`, with `flush_interval -1` for `/api/events` (live updates over Server-Sent Events).
- **No `forward_auth` (Authelia, Authentik) in front of this site.** Family time does its own sign-in; a gateway breaks invite links, passkey sign-up, `/api/events`, web push and `/mcp`.
- Whether the hostname is reachable from outside the home is the household's choice. Parents' phones need it for the app away from home; alerts reach phones through the push services either way.

### AdGuard Home (the default: the household's own)

- AdGuard Home **v0.107.79 or a later 0.107 release** (older is refused; a newer series is refused unless `ADGUARD_ALLOW_UNTESTED=1`).
- Its web address as the VM reaches it, **https preferred** (`https://adguard.home.example`). Over plain http the login crosses the LAN in the clear every minute; Family time warns about this.
- A self-signed certificate is fine if given to `init.sh --adguard-ca FILE`. It must be AdGuard's own certificate naming the host, not a CA certificate.
- A user for Family time with a password used nowhere else (AdGuard Home keeps users in `AdGuardHome.yaml`; `htpasswd -B -n familytime` makes the hash).
- Reachable from the VM (allow the VM's address if AdGuard's host has a firewall).
- **Children's devices must use AdGuard directly for DNS, and AdGuard must see each device's own IP.** If the router forwards all DNS to AdGuard, AdGuard sees only the router and per-device blocking cannot work. Hand out AdGuard's address in DHCP, or set DNS per device.
- Family time writes only clients named `ft-...` and the rules between `! family-time: begin (managed, do not edit by hand)` and `! family-time: end`. Anything else in AdGuard is left alone. Its one-off `adguard-setup` either sets AdGuard's global settings (10 s blocked TTL, 60 s max cache, 7-day query log, 30-day statistics, the HaGeZi DoH/VPN/proxy list, bypass rules) after showing each change, or, with `--family-time-only`, leaves them alone and needs the two marker lines added by hand.
- AdGuard is backed up wherever it runs; Family time does not back it up.
- Router side doors, ideally: allow outbound DNS (53) and DNS over TLS (853) only from AdGuard's host.

Alternative: the **bundled** AdGuard (`init.sh --adguard bundled`), which Family time runs and sets up itself, answering DNS on `LAN_IP:53`.

### The kiosk tablet

- An Amazon Fire tablet with Fully Kiosk Browser PLUS, start URL `http://LAN_IP:8180`, URL allow-list for that address only.
- A DHCP reservation for it; ideally no internet access, as it only needs the server.

### Optional: owner sign-in through Authelia

An OpenID Connect client in Authelia (`identity_providers.oidc.clients`): confidential, `client_secret_basic`, PKCE S256, scopes `openid profile`, RS256 ID tokens, `authorization_policy: two_factor`, redirect URI `https://family.example.com/api/auth/oidc/callback`. The issuer is Authelia's root URL. The plain client secret goes only in `secrets/oidc_client_secret`; Authelia holds its digest. Every sign-in asks for a fresh login (`prompt=login`, `max_age=0`). Full example: `docs/setup/owner-sign-in.md`.

### Backups

- `scripts/backup.sh`, run nightly at 02:30 by `family-time-backup.timer`: a checked Postgres dump (plus the bundled AdGuard's and Besu's data if used) into one restic repository, and `secrets/` plus `deploy/.state` into a second restic repository with its own password.
- Defaults to local folders `/var/backups/family-time/data` and `/var/backups/family-time/keys`. Any restic URL works (another disk, a NAS over SFTP, S3-compatible storage): set it in `deploy/.state/backup.env`. Keep the keys repository's password offline.
- Retention 7 daily, 4 weekly, 6 monthly. `./scripts/restore.sh` drills a restore into a scratch database without touching live.

## Install

As root on the VM (`sudo su -`).

1. Prerequisites:

   ```bash
   apt install -y git openssl curl restic
   docker network inspect proxy_net >/dev/null 2>&1 || docker network create proxy_net
   ```

2. Clone (public repository, no token):

   ```bash
   git clone -b phase-9 https://github.com/breakmylegs/family-time.git /opt/family-time
   cd /opt/family-time
   ```

3. Secrets, the LAN address and the AdGuard choice. It asks for the AdGuard password without showing it, then checks AdGuard is reachable, the login works and the version is supported:

   ```bash
   ./scripts/init.sh --adguard external --adguard-url https://adguard.home.example --adguard-user familytime
   ```

   Add `--adguard-ca /path/to/adguard.crt` for a self-signed certificate. Use `--adguard bundled` instead to have Family time run its own AdGuard. Safe to run again; it keeps what is set.

4. Deploy. Builds the images, runs every test inside them with no network, runs the real-Postgres tests in a throwaway project, migrates, starts, and rolls back on its own if the new version is not healthy. Takes several minutes; it keeps going if SSH drops:

   ```bash
   ./scripts/update.sh
   ```

   It ends with `finished: exit 0, deployed`.

5. AdGuard: look at what would change, then apply it (or use `--family-time-only`):

   ```bash
   ./scripts/ft.sh adguard-setup
   ./scripts/ft.sh adguard-setup --yes
   ```

6. Caddy: add `deploy/caddy/family-time.caddy` to the Caddyfile with the real hostname, and reload Caddy.

7. The first owner: prints a one-time link to open on the owner's iPhone within 24 hours, which makes their passkey. The origin is fixed from then on:

   ```bash
   ./scripts/ft.sh owner-invite --origin https://family.example.com --name "Your name" --family "Family name"
   ```

8. Children and devices, from the app (Settings, Set-up) or the command line:

   ```bash
   ./scripts/ft.sh child-add --name "Child"
   ./scripts/ft.sh device-add --child "Child" --label "Child's iPad" --type ipad --id 192.168.1.50
   ./scripts/ft.sh setup-defaults --child "Child"
   ./scripts/ft.sh services-sync
   ```

9. Start at boot, and nightly backups:

   ```bash
   cp deploy/systemd/family-time.service deploy/systemd/family-time-backup.service deploy/systemd/family-time-backup.timer /etc/systemd/system/
   systemctl daemon-reload && systemctl enable family-time && systemctl enable --now family-time-backup.timer
   ```

10. Check it all:

    ```bash
    ./scripts/verify.sh --url https://family.example.com
    ./scripts/drill-rollback.sh
    ./scripts/backup.sh && ./scripts/restore.sh
    ```

11. Point one child device's DNS at AdGuard first, check `./scripts/ft.sh status --child "Child"` says AdGuard confirmed within a minute, then the rest of the home (`docs/setup/network.md`). Set up the kiosk tablet (`docs/setup/kiosk.md`).

## Running it

- **Deploy updates only with `./scripts/update.sh`**, never raw `docker compose` commands: it checks the deploy state, builds, tests, snapshots the database, migrates and rolls back.
- Everyday commands: `./scripts/ft.sh <command>` (`./scripts/ft.sh help` lists them). Logs of each deploy are in `/opt/family-time/.deploy/logs/`.
- Migrations are additive only, so a rollback swaps images and never touches the database.
- Health: `/healthz` and `/readyz` on the api (readiness covers the database, migrations, the worker's heartbeat, and that the worker reached AdGuard in the last three minutes).

## For the home lab's own plans: what not to do

- Do not put `forward_auth` in front of the Family time site.
- Do not make the router forward all DNS to AdGuard as a single upstream if child devices should be told apart: AdGuard must see each device's address.
- Do not publish the api's port 3000, Postgres, Besu or Ollama; nothing needs them from outside Docker.
- Do not change the public hostname after the first owner is made: passkeys are tied to it.
- Do not put Family time's secrets in environment variables, compose files or command lines; they belong in `/opt/family-time/secrets/`.
- Do not commit anything personal to the repository: it is public.

## Where to read more (in the repository)

`docs/setup/server.md` (install), `docs/setup/network.md` (AdGuard and the home network), `docs/setup/owner-sign-in.md` (Authelia, Authentik), `docs/setup/kiosk.md`, `docs/setup/backup.md`, `docs/setup/ai-and-mcp.md`, `docs/setup/besu.md`, and the decisions in `docs/adr/`.
