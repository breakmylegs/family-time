# ADR 0009: The control engine

Status: accepted, 27 October 2026 (Phase 2)

## Decision

- `packages/domain` holds the engine: pure TypeScript, no I/O, the clock a parameter. Given a child's rules and an instant, it returns each service's state (allowed, blocked, paused), the layer that decided it, a sentence for parents, and when it next changes.
- Precedence: Pause (manual or a scheduled routine pause such as tea), then a parent's override, then school, wind-down and bed blocks, then allowed time (grants, always-allowed), then the policy default.
- One exception protects sleep: an Allow gives way to bedtime unless the parent chose "Through bedtime" (`overrides_bedtime`). "Until tomorrow" is the only duration that sets it. A Block always wins over everything below it.
- Overrides always end. Only a Pause may last until resumed.
- Rules are local wall-clock times in the household's zone. The engine converts with `Intl`, no library. A spring-gap time lands an hour later, like a wall clock; an autumn time that happens twice is the first.
- `until` is found by evaluating the decision at every rule boundary in the next 48 hours and taking the first change.
- `packages/db/src/control.ts` is the one loader from the database into the engine's shape, used by both the api and the worker.
- Reasons name no pronoun ("Ollie planned 30 minutes of screen time"), because V2 serves any family.

## Why

The brief fixes the precedence (Part 4) and asks for property tests and a fake clock. A pure engine makes both easy, and one loader means the screen and AdGuard can never disagree about the rules.

## Consequences

- fast-check properties guard precedence, expiry, `until`, sentence shape and both 2026 clock changes. Two planted faults were each caught by the property that guards them.
- Grant pause and refund on a parent's Block are worked out by the economy in Phase 4; the engine already gives the Block priority.
