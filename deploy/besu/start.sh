#!/bin/bash
# Starts the family's single-validator QBFT Besu (ADR 0014). On the first start it writes the
# genesis, with this node as the only validator, into the data volume; after that it reuses it.
# Gas is free (min-gas-price 0 and a zero base fee) but each block and call is capped at 50
# million, Cancun is on from block 0 (the contract needs it), and only the ETH, NET and WEB3 APIs
# answer: no QBFT, so nothing can vote in another validator and halt the chain.
#
# A genesis made before the 50 million block gas limit keeps its own limit; that is fine.
#
# The validator key comes from the Docker secret init.sh made. The test project has no secret,
# so it makes a throwaway key in its temporary data folder.
set -euo pipefail

DATA=${BESU_DATA:-/opt/besu/data}
BLOCK_SECONDS=${BLOCK_SECONDS:-5}
CHAIN_ID=${CHAIN_ID:-4242}
KEY=${BESU_NODE_KEY_FILE:-}

mkdir -p "$DATA"
if [ -z "$KEY" ]; then
  # The test project only: it sets no key file.
  KEY=$DATA/throwaway-key
  [ -s "$KEY" ] || od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$KEY"
  echo "start.sh: no validator key file set, so using a throwaway one (tests only)"
elif [ ! -r "$KEY" ] || [ ! -s "$KEY" ]; then
  echo "start.sh: the validator key $KEY is missing or empty. Run ./scripts/init.sh again." >&2
  exit 1
fi

if [ ! -s "$DATA/genesis.json" ]; then
  besu public-key export-address --node-private-key-file="$KEY" --to="$DATA/validator-address"
  printf '["%s"]' "$(tr -d '[:space:]' < "$DATA/validator-address")" > "$DATA/validators.json"
  extra=$(besu rlp encode --from="$DATA/validators.json" --type=QBFT_EXTRA_DATA | tr -d '[:space:]')
  cat > "$DATA/genesis.json.tmp" <<EOF
{
  "config": {
    "chainId": $CHAIN_ID,
    "berlinBlock": 0,
    "londonBlock": 0,
    "shanghaiTime": 0,
    "cancunTime": 0,
    "zeroBaseFee": true,
    "qbft": { "blockperiodseconds": $BLOCK_SECONDS, "epochlength": 30000, "requesttimeoutseconds": $((BLOCK_SECONDS * 2)) }
  },
  "nonce": "0x0",
  "timestamp": "0x0",
  "gasLimit": "0x2faf080",
  "difficulty": "0x1",
  "mixHash": "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
  "coinbase": "0x0000000000000000000000000000000000000000",
  "alloc": {},
  "extraData": "$extra"
}
EOF
  mv "$DATA/genesis.json.tmp" "$DATA/genesis.json"
  echo "start.sh: wrote the genesis for validator $(cat "$DATA/validator-address")"
fi

# Drop root (ADR 0014, 0017). Started as root only to read the key secret, which Compose mounts
# root-only: the key is copied to a tmpfs that Besu's own user owns, the data folder is handed to
# that user, and Besu runs as it. If any step is not possible (an image without setpriv or the
# besu user), it carries on as root and says so, rather than leave the chain stopped.
RUN_AS=()
if [ "$(id -u)" = 0 ] && id besu >/dev/null 2>&1 && command -v setpriv >/dev/null 2>&1 && [ -d /run/besu ]; then
  if install -o besu -g besu -m 0400 "$KEY" /run/besu/node_key 2>/dev/null && chown -R besu:besu "$DATA" 2>/dev/null; then
    KEY=/run/besu/node_key
    RUN_AS=(setpriv --reuid=besu --regid=besu --init-groups --)
  else
    echo "start.sh: could not hand the key and data to the besu user, so Besu runs as root" >&2
  fi
fi

exec "${RUN_AS[@]}" besu \
  --data-path="$DATA/chain" \
  --genesis-file="$DATA/genesis.json" \
  --node-private-key-file="$KEY" \
  --min-gas-price=0 \
  --p2p-enabled=false \
  --rpc-http-enabled \
  --rpc-http-host=0.0.0.0 \
  --rpc-http-port=8545 \
  --rpc-http-api=ETH,NET,WEB3 \
  --rpc-gas-cap=50000000 \
  --host-allowlist=besu,localhost \
  --logging=INFO
