# Phase 5 plan: the Besu ledger

Branch `phase-5`, from `phase-4`. Waiting for your approval (brief Part 21). Nothing here touches your network: Besu runs only on the stack's internal Docker network, behind a Compose profile that is off unless you turn it on.

## Goal

The same ledger, written to a private Besu chain as well as read from Postgres, so the economy can run on either adapter. The Postgres ledger stays the default and the V2 default. Besu is the learning layer the brief asks for, with a contract that makes the house rules (no transfers, no deductions, references used once) true on chain.

## Exit criteria

1. On the server, in `update.sh`'s test stage: `forge test` passes, including fuzz and invariant tests (supply equals minted minus burned, no transfer ever succeeds, a reference is never reused).
2. On the server, in the same stage: the LedgerPort contract suite and the simulated fortnight from Phase 4 pass against the Besu adapter on a throwaway Besu node, as they do against Postgres.
3. On the server: the read model rebuilds from the chain into an empty table and matches the live one, and the redeploy and replay drill (`./scripts/drill.sh ledger`) moves the history onto a new contract and the balances match.
4. Here: the signer, the indexer and the adapter pass their unit tests against a fake chain, and Playwright screenshots the owner's Ledger screen in light and dark.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | One contract, `contracts/src/FamilyLedger.sol`: ERC-1155 and AccessControl on OpenZeppelin Contracts 5.x, Solidity pinned. Token ids 1 TIME (minutes), 2 MONEY (pence), 3 FLEX (points). No proxy: immutable and versioned | Brief Part 7 |
| 2 | Soulbound: `_update` reverts unless it mints or burns, and `setApprovalForAll` reverts | Brief Part 7 |
| 3 | One function per kind of entry (award, allocate, spend, refund, convert, close, payout, reverse), each taking a `bytes32` reference and a reason code; a used reference reverts. The burn paths are fixed: TIME burns only by spend or close, MONEY only by payout, FLEX only by convert at the rates on chain. There is no general burn, so no deduction can be written even by our own signer | Brief Part 7 and Part 22, by construction |
| 4 | Corrections on chain the same way as in Postgres: `reverse(ref, originalRef)` reads what the original did, applies exactly the opposite, and only once | Phase 4 decision 5, now enforced by the contract too |
| 5 | A child's account is an address derived from the child's id (no private key exists for it). Nothing can sign for a child, which suits soulbound tokens | No keys to lose or leak |
| 6 | Writes stay fast: the Besu adapter validates exactly as the Postgres adapter does (under the same advisory lock, against the read model), writes the entry as `pending`, and queues the transaction in the same database transaction. The api answers at once; the entry shows as confirmed when its block arrives (about 5 seconds) | A tap that waits for a block feels broken; the contract checks again, so a disagreement fails loudly |
| 7 | Signer: one pg-boss queue, concurrency 1, singleton key, viem wallet client with a local account and nonce manager. A new `ledger_tx` table records pending, sent, mined and failed. On restart it reconciles with `eth_getTransactionCount` (pending tag) and receipts. A failed transaction alerts the owner | Brief Part 7 |
| 8 | Indexer: a worker loop with viem `getLogs` from the last processed block, writing block number and transaction hash into the existing `ledger_entries` rows (matched by reference), idempotent on block number and log index. One confirmation is final under QBFT | Brief Part 7; Phase 4 left those columns for this |
| 9 | Besu 26.10.x in Compose profile `ledger-besu`: single validator QBFT, `min-gas-price=0`, zero base fee, 5-second blocks, RPC APIs `ETH,NET,QBFT,WEB3` on the internal network only, JVM capped at 2 GB. I verify the image name (the repository moved to besu-eth/besu) and its linux/arm64 digest before pinning | Brief Part 7 and research section 3 |
| 10 | Keys: `init.sh` makes the validator node key, the signer key and the admin key as files in `secrets/`. Deploying the contract uses the admin key once to grant the signer its roles; after that the admin key belongs offline, and the report tells you how | Brief Part 7: admin on a cold key |
| 11 | Which adapter runs is one setting, `LEDGER_ADAPTER=postgres` (default) or `besu`, read at start. Switching to Besu replays the existing Postgres history onto a fresh contract first, so nothing is lost | V2 default stays Postgres |
| 12 | Ledger screen, owner only: every entry with its block number, transaction hash and status, the signer's queue and the last indexed block. Reached from Settings | Brief Part 7 |
| 13 | Tests: forge unit, fuzz and invariant tests in a new `contracts` build stage using the pinned Foundry image; the LedgerPort suite and the simulated fortnight against a throwaway Besu node (1-second blocks) in `deploy/compose.test.yml`; signer and indexer unit tests against a fake chain that runs here | Brief Part 19: ledger tests against both adapters |

## Open questions, with what I recommend

1. **Foundry on this laptop.** Recommend: do not install it. It is a downloaded binary toolchain on a work laptop, the same kind of thing that raised the gitleaks alert. Contracts compile and test in the server's build stage instead, and the contracts-reviewer subagent reviews every change. The cost is a slower loop: a Solidity mistake shows up in your `update.sh` output, not here.
2. **A local Solidity compiler.** `solc` from npm (the official compiler as WebAssembly) would let me compile here. It is not in brief Part 17, so I have left it out. Recommend: leave it out unless the slow loop in question 1 gets in the way.
3. **Conversion rates on chain.** Recommend: the signer sets them (a `RATES_ROLE`), with an event each time, rather than the offline admin key, so a rate change in Settings doesn't need the cold key.
4. **The savings bar going down when money is paid.** From the Phase 4 reviews: the bar counts money still owed, so marking a payout moves it back, which will look like a loss on the kiosk. Recommend for Phase 6: count progress as money earned since the goal was set, so paying out never moves the bar back.
5. **Server memory.** Besu wants 2 to 3 GB. Recommend: keep the profile off until you've checked the server has the room (`free -h`), and leave it off for V2 households.

## Dependencies

viem 2.x (brief Part 17, verified and pinned at the start). OpenZeppelin Contracts 5.x and Foundry 1.8.x run only in the server's build stage. Besu 26.10.x image. Nothing outside brief Part 17.

## Files

- `contracts/` (new): Foundry project, `FamilyLedger.sol`, unit, fuzz and invariant tests, `foundry.toml` pinning Solidity and the optimiser.
- `packages/ledger`: the Besu adapter, the contract's ABI as a typed constant (checked against the forge build in the test stage), the signer, the indexer, the fake chain, and the suite run against Besu.
- `packages/db`: migration `0008`: `ledger_tx` and an index on block number and log index. Additive only.
- `apps/worker`: the signer queue, the indexer loop, the reconcile on start, the failed-transaction alert.
- `apps/api`: the owner's ledger routes; CLI `ledger-deploy`, `ledger-replay`, `ledger-rebuild`.
- `apps/parent`: the Ledger screen and its Settings row.
- `deploy/`: the `ledger-besu` profile, genesis template, the throwaway Besu node in `compose.test.yml`; `Dockerfile` gains the `contracts` stage.
- `scripts/`: key generation in `init.sh`, `drill.sh ledger`, backup of the Besu volume noted for Phase 8.
- ADR 0014 (Besu adapter and signer), `docs/versions.md`, `docs/setup/` for turning the profile on.
