# Pointing the home network at AdGuard

For the owner. These steps are yours: Family time never changes your router, and nothing in it uses AdGuard until you do this. Do them once Phase 2 is deployed and `./scripts/ft.sh adguard-setup --yes` has run.

Note your router's current DNS settings first, so you can put them back if anything goes wrong.

## 1. Try one device first

Before touching the router, point only your son's iPad at AdGuard.

1. On the iPad: Settings, Wi-Fi, tap the (i) next to your network.
2. Private Wi-Fi Address: set to **Fixed**. Family time recognises the iPad by its address, so it must not change.
3. Configure DNS: Manual. Delete the servers listed, add the server's LAN address (the `LAN_IP` in `deploy/.state/network.env` on the server).
4. On the server: `./scripts/ft.sh status --child "<name>"`. Within a minute the device line should say `AdGuard confirmed`.
5. Block YouTube from the command line or the app, and check a new video will not start on the iPad within a minute.

If websites stop loading on the iPad, set Configure DNS back to Automatic. Nothing else on the network is affected.

## 2. Then the whole home

On the router, set the DNS server it hands out (DHCP DNS) to the server's LAN address. Router menus differ; it is usually under LAN, DHCP or Network.

Many ISP routers, BT's among them, do not let you change this. The options then are:

- set DNS by hand on each child device, as in step 1, or
- turn off the router's DHCP and use AdGuard's own DHCP server (ask me first: it is a bigger change), or
- put your own router behind the ISP one in modem mode.

## 3. Close the side doors

These stop a device getting round AdGuard. Do the ones your router supports.

- [ ] Allow outbound DNS (port 53, TCP and UDP) only from the server's LAN address. Everything else on port 53 is blocked, so a device with hard-coded DNS (8.8.8.8) cannot use it.
- [ ] Block outbound port 853 (DNS over TLS) for everything except the server.
- [ ] On the iPad, in Screen Time: Content and Privacy Restrictions, Account Changes: Don't Allow, and Installing Apps: Don't Allow (or Ask). This stops VPN apps and DNS profiles being installed.
- [ ] Set up a DHCP reservation (static lease) for the iPad on the router, so its address never changes.

AdGuard itself already handles the rest once `adguard-setup` has run: iCloud Private Relay, Firefox's automatic DNS over HTTPS and Apple's own DNS over HTTPS are turned away, and a list of known DNS-over-HTTPS, VPN and proxy services is blocked.

## What it cannot stop

- Mobile data. DNS blocking works on home Wi-Fi only. Screen Time on the iPad stays on as the backstop.
- A video or game already running. Blocks stop new connections, so changes take up to a minute and something already playing can finish.

If the iPad stops asking AdGuard anything for 30 minutes outside bedtime, Family time marks it quiet. That usually means mobile data, a VPN, or DNS set somewhere else.
