# ADR 0008: Every route declares who may call it

Status: accepted, 27 October 2026 (Phase 1)

## Decision

Every route sets `config.access` to `public`, `session`, or a capability. An `onRoute` hook throws at startup if one does not, so the server will not start with an open route. The check runs in `onRequest`, before the body is parsed, together with the rate limit, the Origin check and the CSRF check.

Roles map to a closed list of capabilities in `apps/api/src/auth/capabilities.ts`. The owner has all of them. A new capability is given to parents or carers only by editing that table.

The database backs this up where code alone could be bypassed: a trigger keeps at least one active owner, and audit events cannot be updated or deleted.

## Why

A guard that each route must remember is a guard a later phase will forget. Running before body parsing means a refused request costs nothing, and a rate limit cannot be skipped by a request that fails to parse (a sibling app's limiter never ran for weeks because of that).

## Consequences

- Tests that add throwaway routes must give them an access rule too.
- Health routes are `public` and skipped by the hook entirely, so `/healthz` touches nothing even when a browser sends a cookie.
