# ADR 0003: The api serves the parent and kiosk builds

Status: accepted, 26 October 2026 (Phase 0 plan approved). Applies from Phase 3.

## Decision

The api container serves the parent PWA and the kiosk static builds. There are no separate static containers. The kiosk is served on a second listener bound to the server's LAN address only, so Caddy never exposes it.

## Why

- One origin for the parent app and its API, so session cookies, CSRF and Server-Sent Events need no cross-origin rules.
- One image and one tag per deploy, so the UI and the API it talks to can never be different versions.
- At home, two more containers buy nothing: there is no CDN and no separate scaling.

## Consequences

- Static assets get long cache headers with hashed file names; `index.html` and the service worker are never cached.
- The kiosk listener is opened in Phase 6 and needs a port published on the LAN address only.
