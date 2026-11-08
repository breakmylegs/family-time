#!/bin/bash
# Account permissioning for the family's Besu node (ADR 0014 follow-up): only the ledger signer may
# send transactions. Runs once before Besu starts, with no network, to work out the signer's
# address from its key; only the address is written, to a volume Besu reads. Besu itself never
# sees the signer key.
set -euo pipefail

KEY=${LEDGER_SIGNER_KEY_FILE:-/run/secrets/ledger_signer_key}
OUT=${PERMISSIONS_DIR:-/permissions}

if [ ! -r "$KEY" ] || [ ! -s "$KEY" ]; then
  echo "allowlist.sh: the signer key $KEY is missing or empty. Run ./scripts/init.sh again." >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
besu --data-path="$tmp/data" public-key export-address --node-private-key-file="$KEY" --to="$tmp/address" >/dev/null
address=$(tr -d '[:space:]' < "$tmp/address")
if ! [[ "$address" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "allowlist.sh: could not work out the signer's address" >&2
  exit 1
fi

# Break glass (docs/setup/besu.md): if the signer key is ever stolen, the owner lists the cold admin
# key's address in deploy/besu/admin-allowlist for one start, so it can revoke the signer on chain.
allowed="\"$address\""
EXTRA=${ADMIN_ALLOWLIST_FILE:-/besu-setup/admin-allowlist}
if [ -s "$EXTRA" ]; then
  while read -r extra; do
    [ -z "$extra" ] && continue
    if ! [[ "$extra" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
      echo "allowlist.sh: $EXTRA may only hold addresses like 0x and 40 hex digits, one a line" >&2
      exit 1
    fi
    allowed="$allowed,\"$extra\""
    echo "allowlist.sh: the admin address $extra may also send transactions, for now. Delete $EXTRA and restart Besu when you are done."
  done < "$EXTRA"
fi

printf 'accounts-allowlist=[%s]\n' "$allowed" > "$OUT/accounts.toml.tmp"
chmod 0644 "$OUT/accounts.toml.tmp"
mv "$OUT/accounts.toml.tmp" "$OUT/accounts.toml"
echo "allowlist.sh: the signer, $address, may send transactions"
