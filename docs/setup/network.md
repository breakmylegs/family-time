# AdGuard and the home network

For the owner. Family time blocks apps by writing to AdGuard Home: one client per child device, and its own block of custom rules (ADR 0010). It never changes your router, and nothing on the network uses AdGuard until you point it there.

Family time works with an AdGuard in one of two ways (ADR 0022). `./scripts/init.sh` asks which, and you can change it later by running it again.

- **External, the default.** Your own AdGuard Home, already running elsewhere on the home network and managed by another setup. Family time signs in to it and manages only what it is allowed to.
- **Bundled.** Family time runs an AdGuard Home of its own, in its stack, and sets it up from scratch. It answers DNS on the server's LAN address.

## Your own AdGuard (external)

### What it needs

- **Its address, https if you can.** The address of its web page, as this server reaches it: for example `https://adguard.home.example`, or `http://192.168.1.2:3000`. No path after the host. Check it from the server: `curl -sS -o /dev/null -w '%{http_code}\n' https://adguard.home.example/control/status` should print `401` or `403` (it answers, and wants a login).
- **Why https matters.** Family time signs in to AdGuard about once a minute, and AdGuard's login has no roles: whoever has it controls DNS for the whole home. Over plain http that password crosses your network unencrypted, where a device on the same Wi-Fi (a teenager's laptop included) can pick it up. Turn on AdGuard's own encryption (Settings, Encryption settings) and use the https address. If you stay on http, `init.sh` and `update.sh` warn you each time; keep this server and AdGuard on a wired network, ideally the same switch or VLAN, and give Family time a user whose password is used nowhere else.
- **Reachable from the server.** Family time's api and worker reach it over Docker's outbound network, so any address the server itself can reach works. If AdGuard's host firewall only allows some addresses, add the server's LAN address. If your home network uses a 172.16.0.0/12 range, Docker's own networks may clash with it; tell me first.
- **https with a self-signed certificate** works only when you opt in: `./scripts/init.sh --adguard-ca /path/to/adguard.crt`. That puts it in `secrets/adguard_ca.pem` and sets `ADGUARD_CA=1`. Only Family time's AdGuard client trusts it; every other connection the server makes keeps the usual trust. It must be AdGuard's own certificate, naming the host in the address, and not a certificate authority (`init.sh` refuses a CA certificate or a bundle, because one could vouch for any server). Certificate checks are never switched off.
- **A user for Family time, with its own password.** AdGuard Home keeps its users in `AdGuardHome.yaml` under `users:`, each with a bcrypt password hash. `htpasswd -B -n familytime` makes one and asks for the password, so it never lands in your shell's history. A user of its own makes Family time's changes easy to tell apart in AdGuard's logs. Your existing admin login also works, but then that password is the one crossing the network.
- **Its version.** Family time is tested with AdGuard Home **v0.107.79**. A later 0.107 release is fine, with a note. An older one is refused: update AdGuard first. A newer series (0.108, 1.x) is refused until a Family time update is tested against it; to go ahead anyway, add `ADGUARD_ALLOW_UNTESTED=1` to `deploy/.state/adguard.env` and watch Control for devices that show Not confirmed.
- **To see each device's own address.** Family time recognises a child's device by its IP address (or MAC, or ClientID). If your router forwards every DNS query to AdGuard itself, AdGuard only sees the router, and per-device rules cannot work. Hand out AdGuard's address to devices directly (DHCP DNS), as below.

### Connect it

```bash
cd /opt/family-time && ./scripts/init.sh --adguard external --adguard-url http://192.168.1.2:3000 --adguard-user familytime
```

It asks for the password without showing it, and never takes it on the command line. It is saved in `secrets/adguard_password`, readable by root only. To run it unattended, pipe the password in with `--adguard-password-stdin`. To change the password later: `./scripts/init.sh --adguard-new-password`. Running `init.sh` again keeps everything already set unless you give it again.

`init.sh` then checks that the server can reach AdGuard, that the login works and that the version is supported. `update.sh` checks the same thing before every deploy and stops, with the reason, if any of them fails. Nothing live changes until it passes.

### Decide what Family time manages

Family time never runs AdGuard's first-time setup on your AdGuard. Look at what it would change first; this changes nothing:

```bash
./scripts/ft.sh adguard-setup
```

It lists each global setting it would change, as it is now and as it would be. These are AdGuard's own settings, so they apply to every device that uses it, adults' included:

- how long devices keep a block or an answer (10 seconds blocked, at most 60 seconds cached), so a change reaches devices within a minute
- the query log, kept 7 days
- statistics, kept 30 days
- the HaGeZi list of DNS-over-HTTPS, VPN and proxy services (this can stop an adult's work VPN on home Wi-Fi)
- the bypass rules (iCloud Private Relay, Firefox's automatic DNS over HTTPS, Apple's DNS over HTTPS), which go at the top of Family time's own rules block and also apply to every device

Then choose one:

- **Let it set them:** `./scripts/ft.sh adguard-setup --yes`.
- **Leave your global settings alone:** `./scripts/ft.sh adguard-setup --family-time-only --yes`. Family time then manages only its own `ft-` clients and the rules between its two markers, and never adds the markers itself. Add them first: in AdGuard, open Filters, Custom filtering rules, add these two lines, one under the other, then Apply:

  ```
  ! family-time: begin (managed, do not edit by hand)
  ! family-time: end
  ```

  If the markers are missing, `adguard-setup` stops and says how to add them, and Control shows the devices as Not confirmed until they are there. Keep your own rules outside them; Family time never touches anything outside its markers or any client whose name does not start with `ft-`. With this choice the bypass rules are never written, because they affect every device, and AdGuard's caching is yours to set: answers cached for longer than a minute make blocks slower to land.

### What "confirmed" means here

When Control says a device is confirmed, AdGuard holds Family time's client for it and Family time's rules block, read back after writing. It does not yet check every other rule in your AdGuard: an allow rule of your own outside the markers (such as `@@||youtube.com^`) still wins. Keep allow rules for the children's devices out of your own rules.

### Backups

Your AdGuard is backed up wherever it runs. Family time's nightly backup does not copy it, and says so. After a restore, Family time writes its own clients and rules block back within a minute.

## The bundled AdGuard

```bash
cd /opt/family-time && ./scripts/init.sh --adguard bundled && ./scripts/update.sh && ./scripts/ft.sh adguard-setup --yes
```

It runs in Family time's stack with the `adguard-bundled` Compose profile and answers DNS on the server's LAN address (`LAN_IP` in `deploy/.state/network.env`) only. Its admin page is never published: only the api and worker reach it. `adguard-setup --yes` runs its first-time setup with a random password `init.sh` made, then the global settings above. The nightly backup copies its settings.

## Pointing devices at AdGuard

Use your AdGuard's address (external) or the server's LAN address (bundled). Note your router's current DNS settings first, so you can put them back if anything goes wrong.

### 1. Try one device first

Before touching the router, point only your son's iPad at AdGuard.

1. On the iPad: Settings, Wi-Fi, tap the (i) next to your network.
2. Private Wi-Fi Address: set to **Fixed**. Family time recognises the iPad by its address, so it must not change.
3. Configure DNS: Manual. Delete the servers listed, add AdGuard's address.
4. On the server: `./scripts/ft.sh status --child "<name>"`. Within a minute the device line should say `AdGuard confirmed`.
5. Block YouTube from the command line or the app, and check a new video will not start on the iPad within a minute.

If websites stop loading on the iPad, set Configure DNS back to Automatic. Nothing else on the network is affected.

### 2. Then the whole home

On the router, set the DNS server it hands out (DHCP DNS) to AdGuard's address. Router menus differ; it is usually under LAN, DHCP or Network. If your AdGuard already serves the home, this is done.

Many ISP routers, BT's among them, do not let you change this. The options then are:

- set DNS by hand on each child device, as in step 1, or
- turn off the router's DHCP and use AdGuard's own DHCP server (ask me first: it is a bigger change), or
- put your own router behind the ISP one in modem mode.

### 3. Close the side doors

These stop a device getting round AdGuard. Do the ones your router supports.

- [ ] Allow outbound DNS (port 53, TCP and UDP) only from AdGuard's host. Everything else on port 53 is blocked, so a device with hard-coded DNS (8.8.8.8) cannot use it.
- [ ] Block outbound port 853 (DNS over TLS) for everything except AdGuard's host.
- [ ] On the iPad, in Screen Time: Content and Privacy Restrictions, Account Changes: Don't Allow, and Installing Apps: Don't Allow (or Ask). This stops VPN apps and DNS profiles being installed.
- [ ] Set up a DHCP reservation (static lease) for the iPad on the router, so its address never changes.

Once `adguard-setup` has set them, AdGuard turns away iCloud Private Relay, Firefox's automatic DNS over HTTPS and Apple's own DNS over HTTPS, and blocks a list of known DNS-over-HTTPS, VPN and proxy services. With `--family-time-only`, these are yours to set.

## What it cannot stop

- Mobile data. DNS blocking works on home Wi-Fi only. Screen Time on the iPad stays on as the backstop.
- A video or game already running. Blocks stop new connections, so changes take up to a minute and something already playing can finish.

If the iPad stops asking AdGuard anything for 30 minutes outside bedtime, Family time marks it quiet. That usually means mobile data, a VPN, or DNS set somewhere else.
