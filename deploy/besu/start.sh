#!/bin/bash
# Starts the family's single-validator QBFT Besu (ADR 0014). On the first start it writes the
# genesis, with this node as the only validator, into the data volume; after that it reuses it.
# Gas is free (min-gas-price 0 and a zero base fee), Cancun is on from block 0 (the contract
# needs it), and only the ETH, NET, QBFT and WEB3 APIs answer, on the internal network only.
#
# The validator key comes from the Docker secret init.sh made. The test project has no secret,
# so it makes a throwaway key in its temporary data folder.
set -euo pipefail

DATA=${BESU_DATA:-/opt/besu/data}
BLOCK_SECONDS=${BLOCK_SECONDS:-5}
CHAIN_ID=${CHAIN_ID:-4242}
KEY=${BESU_NODE_KEY_FILE:-/run/secrets/besu_node_key}

mkdir -p "$DATA"
if [ ! -s "$KEY" ]; then
  KEY=$DATA/throwaway-key
  [ -s "$KEY" ] || od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$KEY"
  echo "start.sh: no validator key secret, so using a throwaway one (tests only)"
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
  "gasLimit": "0x1fffffffffffff",
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

exec besu \
  --data-path="$DATA/chain" \
  --genesis-file="$DATA/genesis.json" \
  --node-private-key-file="$KEY" \
  --min-gas-price=0 \
  --p2p-enabled=false \
  --rpc-http-enabled \
  --rpc-http-host=0.0.0.0 \
  --rpc-http-port=8545 \
  --rpc-http-api=ETH,NET,QBFT,WEB3 \
  --host-allowlist="*" \
  --logging=INFO
