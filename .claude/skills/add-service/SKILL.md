---
name: add-service
description: Add an app or website to the family-time service catalogue (for example a new game the child plays), so parents can allow, block and plan it. Use when the owner asks to add, block or manage a new app or site.
---

# Add a service to the catalogue

Status: outline. The catalogue arrives in Phase 2; finish this skill then, with real file paths.

A service is either an AdGuard built-in (it has a service id in AdGuard's catalogue, for example `youtube` or `roblox`) or a custom service (a list of domains we block per device with `$client` rules inside our marker comments).

## Steps

1. Check AdGuard's built-in catalogue first (`GET /control/blocked_services/all`, cached in the catalogue table). If the service is there, use its id. Never duplicate a built-in as a custom service.
2. For a custom service, get the domains from the discovery helper (top domains a device used in the last 30 minutes), not from memory. Include CDN and login domains, or blocking will be partial. Record where each domain came from.
3. Add the service with a name, icon (from the shared stroke icon set, never an emoji), category and default group (Video, Games, Social or Chat).
4. Add a test in the reconciler suite that the service's rules land inside the managed markers for the right client, and that nothing outside the markers changes.
5. Run `corepack pnpm gate`.

## Never

- Write to AdGuard from anywhere except the control service.
- Touch filtering rules outside our marker comments.
- Add a service only in AdGuard. The database is the source of truth; the reconciler writes AdGuard.
