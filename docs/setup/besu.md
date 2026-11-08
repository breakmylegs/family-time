# The Besu ledger (optional)

Family time keeps its ledger in Postgres, sealed in a hash chain. You can also have it written to a private blockchain on your server, for learning (ADR 0014). It changes nothing the family sees, and it is off unless you switch it on.

Besu needs about 2 to 3 GB of memory. Check the server has room first:

```bash
free -h
```

## Switch it on

1. Make sure the ledger keys exist. This keeps every secret you already have and only adds what is missing:

   ```bash
   ./scripts/init.sh
   ```

2. Tell the stack to use it, then deploy as usual:

   ```bash
   printf 'LEDGER_ADAPTER=besu\nCOMPOSE_PROFILES=ledger-besu\n' > deploy/.state/ledger.env
   ./scripts/update.sh
   ```

3. Deploy the contract. The admin key is read once from the file and only its address is used:

   ```bash
   ./scripts/ft.sh ledger-deploy < secrets/ledger_admin_key
   ```

   It prints the contract's address and how many entries it has queued. The worker writes them to the chain over the next few minutes.

4. Move the admin key somewhere offline, for example an encrypted USB stick, and delete it from the server. Nothing on the server needs it again, and `init.sh` won't make a new one once a contract is deployed. If you ever deploy a new contract, give its address instead: `./scripts/ft.sh ledger-deploy --admin 0x...`.

Only the ledger signer can send transactions to the node. Before Besu starts, a one-off step works out the signer's address from its key, with no network, and the node refuses every other account. Besu itself never holds the signer key.

## Check it

```bash
./scripts/ft.sh ledger-status    # the contract and the signer's queue
./scripts/ft.sh ledger-check     # rebuilds every balance from the chain and compares it with Postgres
```

The owner's Ledger screen (Settings, then Ledger) shows each entry's block and transaction.

## If the chain refuses an entry

The worker stops writing to the chain and sends the owner an alert. Run `./scripts/ft.sh ledger-check` to see what differs, and keep the output. Nothing the family uses is affected: Postgres keeps working as before.

## If the signer key is ever stolen

Only the signer's account can send transactions to the node, so the admin key cannot act on chain until you let it, for one start:

1. Put the admin key's address (not the key) in `deploy/besu/admin-allowlist`, one line, `0x` and 40 hex digits.
2. Run `./scripts/ft.sh besu-restart`, which restarts Besu with that address allowed too. Then revoke the old signer and grant a new one from the admin key, signed offline.
3. Delete `deploy/besu/admin-allowlist` and run `./scripts/ft.sh besu-restart` again.

Paste what happened into the build chat first: this is a step we take together.

## Switch it off

```bash
rm deploy/.state/ledger.env
./scripts/update.sh
```

The chain's data stays in its Docker volume until you remove it.
