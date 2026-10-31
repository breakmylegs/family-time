# Phase 6 plan: the kiosk

Branch `phase-6`, from `phase-5`. Started straight after Phase 5, as the owner asked (no approval stops); the recommended option is taken at each choice and recorded here. Nothing here touches your router: the firewall rule for the tablet is written into `docs/setup/kiosk.md` for you to apply.

## Goal

Ollie's own screen, on the old Fire tablet in Fully Kiosk: what's on now, his week as 30-minute blocks, planning his time, his jobs with "I did it", his savings goal, his own boredom ideas, asking a grown-up, a Sunday reflection, a calm bedtime screen, and a plain-words page of what Mum and Dad can see. No AI and no (?) icons anywhere on it.

## Exit criteria

1. Here: Playwright in Chromium at 1280 by 800, light and dark, drives the kiosk against the demo family: pair with a code, plan a session (and see why a greyed window is greyed), log a job with "I did it", ask a grown-up, add a boredom idea, answer the Sunday reflection, see the night screen. Screenshots of every screen in `docs/screens/phase-6/`. The JavaScript is under 150 KB and builds to ES2017.
2. Here: route tests for the kiosk API (token scope, revocation, a kiosk can act only for its own household's children, rate limits on pairing).
3. On the Fire tablet, later: Ollie plans a session and logs a job without help.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | `apps/kiosk`: Preact 10.29.8, Vite 8, plain CSS custom properties from `packages/tokens`, Poppins self-hosted, build target ES2017, JSX through Vite's own esbuild settings (no Preact plugin needed) | Brief Parts 11 and 17; one dependency fewer |
| 2 | The api serves the kiosk build and the kiosk API from a **second Fastify instance** in the same process, on its own port, published on the server's LAN address only (`LAN_IP:8180`). Kiosk routes exist only there; parent routes only on the main one | ADR 0003: the kiosk is LAN only and Caddy never sees it |
| 3 | **Pairing**: the owner taps "Set up the kiosk" in Settings and gets a 6-digit code for 10 minutes; the kiosk's first screen asks for it and swaps it for a long-lived device token (stored hashed, sent as a bearer header, kept in the WebView's storage). Settings lists kiosks and can remove one, which stops it at once. Pairing is rate-limited | Brief Part 8: a long-lived, revocable token scoped to the kiosk API. No cookies, so no CSRF to manage |
| 4 | **Children on the kiosk**: one child goes straight to their home; with several, a profile picker. The optional 4-digit PIN for siblings is left for Phase 8 | The pilot has one child on the tablet; the picker keeps V2 working |
| 5 | **Planning** uses the Phase 4 rules (`checkPlan`): app or group, now or later today, 30 or 60 minutes, what it costs and what is left. Windows that don't fit are greyed with the reason in the child's words ("Wind-down starts at 19:30") | Brief Part 11 |
| 6 | **I did it**: an optional photo (the Fully Kiosk camera through a file input, shrunk to 1024 px on the tablet), then "With Mum or Dad". Photos are stored in Postgres, shown on the Approvals card, and deleted 30 days after the decision by the worker | Brief Parts 6 and 11; the help text already promises the 30 days |
| 7 | **Alerts**: a new completion or request from the kiosk queues the parents' phone alert, closing the Phase 4 gap | Phase 4 report, open risk 1 |
| 8 | **Savings goal**: progress counts pocket money earned since the goal was set, so paying out never moves the bar back. The Family screen and help text change to match | Phase 4 reviews; no loss framing on the kiosk |
| 9 | **Boredom menu**: the child's own ideas, added on the kiosk, shown as a row of chips; parents can remove one. **Sunday reflection**: three short questions, shown from the week's last day until the reset, answers on the Family review agenda | Brief Parts 11 and 14 (reward-less phase onwards) |
| 10 | **Night mode**: in the bed block, a calm screen with the time and "Sleep well"; the Fully bridge turns the screen off after 2 minutes, motion wakes it, and the page reloads on screen-on | Brief Part 11 |
| 11 | **`kioskBridge`**: one module wrapping Fully Kiosk's JavaScript interface, doing nothing in a normal browser | Brief Part 11 |
| 12 | **Freshness**: the kiosk polls every 15 seconds (and on screen-on) rather than holding an event stream | Old WebView, sleeps and wakes; simpler and robust |
| 13 | **Copy**: positive framing, no countdowns; the mock's video line corrected as the brief says. A "What Mum and Dad can see" page in plain words | Brief Parts 11 and 18 |

## Dependencies

`preact` 10.29.8 (brief Part 17). Everything else is already in the repo (Vite, `@fontsource/poppins`, Playwright with Chromium).

## Files

- `apps/kiosk` (new): screens, `kioskBridge`, the API client, styles.
- `apps/api`: the kiosk server and its routes, pairing and device tokens, photos, ideas, reflections; Settings routes to pair and remove kiosks.
- `packages/db`: migration `0009`: kiosk devices and pairing codes, completion photos, ideas, reflections, a goal's start. Additive only.
- `packages/schemas`: the kiosk's shapes.
- `apps/worker`: photo deletion; completion and request alerts are queued by the api.
- `apps/parent`: Settings "Kiosk" section, photos on Approvals, reflections on Family, the goal wording.
- `deploy/`: the kiosk port on the LAN address. `docs/setup/kiosk.md`. ADR 0015. Playwright `kiosk` project.
