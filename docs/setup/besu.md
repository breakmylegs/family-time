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

4. Move the admin key somewhere offline, for example an encrypted USB stick, and delete it from the server. Nothing on the server needs it again. If you ever deploy a new contract, give its address instead: `./scripts/ft.sh ledger-deploy --admin 0x...`.

## Check it

```bash
./scripts/ft.sh ledger-status    # the contract and the signer's queue
./scripts/ft.sh ledger-check     # rebuilds every balance from the chain and compares it with Postgres
```

The owner's Ledger screen (Settings, then Ledger) shows each entry's block and transaction.

## If the chain refuses an entry

The worker stops writing to the chain and sends the owner an alert. Run `./scripts/ft.sh ledger-check` to see what differs, and keep the output. Nothing the family uses is affected: Postgres keeps working as before.

## Switch it off

```bash
rm deploy/.state/ledger.env
./scripts/update.sh
```

The chain's data stays in its Docker volume until you remove it.
