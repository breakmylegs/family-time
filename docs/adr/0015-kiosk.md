# ADR 0015: The kiosk

Status: accepted, 31 October 2026 (Phase 6)

## Decision

- **Its own listener.** The api process runs a second Fastify instance for the kiosk, on port 3001 inside the container, which Compose publishes on the server's LAN address only (`LAN_IP:8180`). Kiosk routes exist only there, parent routes only on the main server, and Caddy never sees the kiosk. This is the second listener ADR 0003 planned.
- **Pairing, then a device token.** An owner taps Set up the kiosk in Settings and gets a 6-digit code for 10 minutes; a new code voids the household's older ones. The kiosk's first screen asks for it and swaps it, once, for a 32-byte random token, stored hashed in `kiosk_devices` and sent as a bearer header. No cookies, so nothing for another web page to ride on and no CSRF to manage. Removing the kiosk in Settings stops it at once. Pairing is rate-limited (10 tries per 10 minutes per address).
- **Scope.** A kiosk acts only for the children of its own household, and only as a child can: plan from the week, say a job is done (with an optional photo), ask a grown-up, add an idea, answer the Sunday questions. It cannot change rules, allow or block, or reach any parent route.
- **The server does the words.** Every label on the kiosk (the pill, "YouTube until 19:00", the reasons a time won't fit, the week's caption) is made on the server in the child's words; the kiosk only shows them.
- **Preact 10, ES2017, plain CSS**, Poppins self-hosted, 35 KB of JavaScript; the build fails past 150 KB. Fresh by polling every 15 seconds and on screen-on, rather than an event stream an old WebView may drop when it sleeps.
- **Photos** from "I did it" are shrunk to 1024 px on the tablet, stored in Postgres (`completion_photos`), shown on the parent's Approvals card, and deleted by the worker 30 days after the parent's decision.
- **Savings goal** progress is pocket money earned since the goal was set, so a payout never moves the bar back on the kiosk.
- **`kioskBridge`** wraps Fully Kiosk's JavaScript interface: motion wakes the screen, the screen goes off two minutes into bedtime, and the page reloads on screen-on. In a normal browser it does nothing.

## Why

Brief Parts 8, 11 and 22: LAN only, a long-lived revocable token, no AI and no (?) on the kiosk, positive framing, and an old tablet to run on.

## Consequences

- Anyone on the home Wi-Fi can reach the kiosk's port, but without a token or a fresh code it does nothing beyond show the setup screen. A router usually cannot fence traffic between devices on the same Wi-Fi, so narrowing the port to the tablet would need a rule on the server (left for the owner to decide).
- The kiosk is plain HTTP on the LAN. A hostile device on the Wi-Fi could read the token or rewrite the page; the content security policy, Fully's URL whitelist and the token's revocation limit that, and it is an accepted risk for a home network. HTTPS on the LAN listener is left for later.
- The pairing code is stored as a SHA-256 of six digits, which is easy to reverse: it is protected by lasting only ten minutes, by voiding older codes, and by voiding every code after 20 wrong guesses from all addresses together, not by the hash.
- Port 3001 is also reachable from containers on the Caddy network the api joins; a token is still needed.
- Carers see jobs and their photos on Approvals; the child's privacy page says so. The Sunday answers are for parents and owners only.
- For Phase 7: the week summary carries the child's Sunday answers, so it must not be handed to an AI provider as it is.
- Siblings share the kiosk through a "Who's here?" picker. Each child can have an optional four-number PIN (brief Part 8, added after Phase 8, migration `0012`): the owner sets it in Settings, Kiosk; it is kept as a salted scrypt hash; typing it gives that tablet a ticket for that child, held in memory on the server and in the WebView's session storage, and every kiosk route for a child with a PIN needs it. A ticket lasts 30 minutes from its last use, ends when the PIN changes, and the kiosk forgets it when the screen goes off, after five minutes untouched, or on switching child. Eight tries per child per tablet each ten minutes; hitting the limit is audited. A sibling can use up the tries on purpose, which locks the child out for ten minutes; that is accepted. The export leaves the hashes out. Four numbers keep a brother or sister out, not a determined adult with the database.
- Photos live in the database, so the nightly backup (Phase 8) carries them until they are deleted.
