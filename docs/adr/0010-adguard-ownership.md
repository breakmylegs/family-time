# ADR 0010: Who writes to AdGuard

Status: accepted, 27 October 2026 (Phase 2)

## Decision

- **The reconciler in the worker is the only writer of devices and rules.** It runs as a pg-boss singleton every 60 seconds and whenever the api or CLI changes something. Each run computes every device's blocked services and our custom rules, writes AdGuard's whole client object (the API replaces it whole), writes our rules block, reads both back, and records `confirmed`, `pending` or, after three failures in a row, `not-confirmed`.
- **We own one block of user rules**, between `! family-time: begin` and `! family-time: end`. Nothing outside it is touched. If the markers are missing, duplicated or reversed, nothing is written and the error says how to fix it.
- **The bypass rules sit at the top of that block**, so the reconciler stays the only rules writer. They are switched on by a household setting.
- **One exception, run by the owner: `./scripts/ft.sh adguard-setup`.** It does AdGuard's first-time setup and the global settings (TTLs, log retention, the HaGeZi bypass list, switching the bypass rules on). Without `--yes` it only prints what it would change. The brief asks for the owner's approval of these, and they are global settings, not per-device control.
- **The api reads the query log** for the discovery helper and never writes.
- Devices are recognised by a client name we generate (`ft-` and 12 hex characters) and their identifiers (IP, MAC, ClientID). The name is safe inside `$client='...'` without escaping; domains and names are checked before any rule is built.
- AdGuard runs in Compose on the internal network (admin API never published) and an egress network (upstream DNS, and port 53 published on the server's LAN address only).

## Why

A second writer is how state ends up half-applied. Reading back after every write is the only way to say "working on his iPad now" honestly. Writing the whole client keeps us safe from the replace-the-whole-object behaviour.

## Consequences

- The client is checked against the vendored v0.107.79 spec on every build. Upgrading AdGuard means vendoring the new spec and passing the contract tests against the real container in `update.sh`'s test project.
- A family that edits rules in AdGuard's own screen keeps those edits, as long as they stay outside our markers.
