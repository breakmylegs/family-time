# ADR 0012: The ledger

Status: accepted, 31 October 2026 (Phase 4)

## Decision

- **One port, `LedgerPort`** in `packages/ledger`, exactly as brief Part 7 lists it: award, allocateAllowance, spendTime, refund, convert, closeWeek, recordPayout, balances, history, verify, plus `reverse` for corrections. Every call takes an idempotency reference; the same reference again returns the first entry and writes nothing, and a reference reused for a different kind or child is refused. The contract is one test suite (`packages/ledger/test/suite.ts`) that every adapter must pass. Phase 5's Besu adapter runs the same suite.
- **The Postgres adapter is one append-only table, `ledger_entries`.** A trigger refuses UPDATE, DELETE and TRUNCATE. One row is one event with signed changes to the child's three balances: TIME in minutes, MONEY in pence, FLEX in points. Rows are numbered per household and each stores the SHA-256 of the previous row's hash plus its own canonical JSON (keys sorted, no whitespace, our own few lines). `verify` walks the chain and names the first entry that is missing, out of order or changed. The worker runs it nightly after 03:00 local time and alerts owners on a break; `./scripts/ft.sh ledger-verify` runs it on demand.
- **One writer at a time**: each append runs in a transaction holding the household's advisory lock, so the balance checks (enough time left, enough owed) and the chain see the latest state. The api gets its answer at once, without a queue round trip.
- **There is no deduction.** Kinds are allowance, award, spend, refund, convert, close, payout and reversal. TIME goes down only through the child's own plan, a counted Allow the parent chose, the week's close and a conversion; MONEY only through a payout; FLEX only through a conversion. A correction (`reverse`, "Fix a mistake" in the app) can only exactly reverse one award, conversion, refund or payout, once, and never takes a balance below zero.
- **The same table is the read model** for Phase 5. (Changed by ADR 0014: the Besu adapter writes entries here first, exactly as this adapter does, and the chain's confirmations go in their own table, because these rows can never be updated.)

## Why

Brief Parts 6, 7 and 22. Making punishment impossible by construction is stronger than a policy against it. A chain a family can verify themselves is the point of a ledger, on Postgres or on a blockchain.

## Consequences

- Someone with the database password can still disable the trigger and edit a row; the chain check finds it the next night. That is detection, not prevention, and is the most a single-server ledger can offer. Besu in Phase 5 is the stronger answer the brief asks to learn from.
- A mistake stays visible: the original entry and its reversal both remain in the history.
- Balances are sums over the child's entries. At a family's scale (hundreds of entries a month) that is fast; a snapshot table can come later without changing the port.
