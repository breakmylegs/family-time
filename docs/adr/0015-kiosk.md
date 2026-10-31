# ADR 0015: The kiosk

Status: accepted, 31 October 2026 (Phase 6)

## Decision

- **Its own listener.** The api process runs a second Fastify instance for the kiosk, on port 3001 inside the container, which Compose publishes on the server's LAN address only (`LAN_IP:8180`). Kiosk routes exist only there, parent routes only on the main server, and Caddy never sees the kiosk. This is the second listener ADR 0003 planned.
- **Pairing, then a device token.** An owner taps Set up the kiosk in Settings and gets a 6-digit code for 10 minutes (stored hashed). The kiosk's first screen asks for it and swaps it, once, for a 32-byte random token, stored hashed in `kiosk_devices` and sent as a bearer header. No cookies, so nothing for another web page to ride on and no CSRF to manage. Removing the kiosk in Settings stops it at once. Pairing is rate-limited (10 tries per 10 minutes per address).
- **Scope.** A kiosk acts only for the children of its own household, and only as a child can: plan from the week, say a job is done (with an optional photo), ask a grown-up, add an idea, answer the Sunday questions. It cannot change rules, allow or block, or reach any parent route.
- **The server does the words.** Every label on the kiosk (the pill, "YouTube until 19:00", the reasons a time won't fit, the week's caption) is made on the server in the child's words; the kiosk only shows them.
- **Preact 10, ES2017, plain CSS**, Poppins self-hosted, 35 KB of JavaScript; the build fails past 150 KB. Fresh by polling every 15 seconds and on screen-on, rather than an event stream an old WebView may drop when it sleeps.
- **Photos** from "I did it" are shrunk to 1024 px on the tablet, stored in Postgres (`completion_photos`), shown on the parent's Approvals card, and deleted by the worker 30 days after the parent's decision.
- **Savings goal** progress is pocket money earned since the goal was set, so a payout never moves the bar back on the kiosk.
- **`kioskBridge`** wraps Fully Kiosk's JavaScript interface: motion wakes the screen, the screen goes off two minutes into bedtime, and the page reloads on screen-on. In a normal browser it does nothing.

## Why

Brief Parts 8, 11 and 22: LAN only, a long-lived revocable token, no AI and no (?) on the kiosk, positive framing, and an old tablet to run on.

## Consequences

- Anyone on the home Wi-Fi can reach the kiosk's port, but without a token or a fresh code it does nothing beyond show the setup screen. The router rule in `docs/setup/kiosk.md` narrows it to the tablet.
- Siblings share the kiosk through a "Who's here?" picker. The optional 4-digit PIN per child (brief Part 8) is left for Phase 8.
- Photos live in the database, so the nightly backup (Phase 8) carries them until they are deleted.
