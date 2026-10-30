# ADR 0011: Live updates, alerts, and who can lift a pause

Status: accepted, 30 October 2026 (Phase 3)

## Decision

- **Live updates are Server-Sent Events carrying no data.** `GET /api/events` sends `change` when something changed for the household; the app then fetches the status as it always does. The api's own routes signal straight away. The worker signals through Postgres `NOTIFY family_time_change` (payload: household id) after every reconcile and usage run, and the api holds one `LISTEN` client that reconnects on error or end. The app polls every 30 seconds only while the stream is down. Each keepalive (25 seconds) checks the session again, so signing out or removal ends the stream; a person can hold six streams at most. Caddy has `flush_interval -1` on the route.
- **Alerts are sent by the worker, from their own pg-boss queue.** Reconcile and usage only queue an alert; a push service that is slow or down can never hold up writes to AdGuard. web-push has a 10-second timeout.
- **The worker joins the `egress` network** (outbound only, nothing published), because Web Push means posting to the browsers' push services. Until Phase 3 only AdGuard had a way out.
- **A push endpoint must be one of the browsers' push services** (Apple, Google, Mozilla, Microsoft), checked with `pushEndpoint()` in `packages/schemas` when stored and again before every send. The part before the path must be plain hostname characters: no port, user or `%` escape, because web-push parses URLs with Node's legacy parser and would otherwise connect somewhere the check never saw. Five subscriptions per person at most.
- **Carers pause everything, and lift only a pause they made.** A carer cannot pause a single app (that would be an open-ended Block, which carers do not have), and cannot resume or undo a parent's pause. The app shows "Only a parent can resume this pause." instead of Resume now.

## Why

One clock and one set of rules: the stream never carries state, so it cannot disagree with the status route. The worker and api are separate processes, and `NOTIFY` is the cheapest reliable bridge between them. The egress and endpoint rules together keep "the server posts to a URL a person gave it" from becoming a way to reach other hosts.

The carer rule follows the role table in brief Part 8 ("pause everything, no rule changes"): a child who picks up Gran's phone must not be able to undo Mum's pause.

## Consequences

- A household whose firewall blocks the server's outbound HTTPS gets no alerts. Settings checks with the server that this phone is still registered and registers it again if not, so a dropped subscription does not look like alerts are on.
- The api still loads the VAPID private key to derive the public one. Splitting the key so only the worker holds the private half is left for Phase 8's hardening (secrets per service).
- Playwright's WebKit build on Windows hangs when asked for a push subscription, so the end-to-end tests block the service worker. Push is checked on a real iPhone.
