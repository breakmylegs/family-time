#!/usr/bin/env bash
# Runs a family-time command inside the deployed api image, against the live database.
#
#   ./scripts/ft.sh owner-invite --origin https://family.example.com
#   ./scripts/ft.sh recovery-link
#   ./scripts/ft.sh help
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -s deploy/.state/image.env ]; then
  echo "ft.sh: nothing is deployed yet. Run ./scripts/update.sh first." >&2
  exit 1
fi

# LAN_IP, and the ledger choice if the owner made one (docs/setup/besu.md).
for env in deploy/.state/network.env deploy/.state/ledger.env; do
  [ -f "$env" ] || continue
  # Only the two settings it is for, so it can never change LAN_IP, IMAGE_TAG or anything else.
  if [ "$env" = deploy/.state/ledger.env ] && grep -Evq '^(#.*|LEDGER_ADAPTER=(postgres|besu)|COMPOSE_PROFILES=ledger-besu|)$' "$env"; then
    echo "deploy/.state/ledger.env may only hold LEDGER_ADAPTER=postgres|besu and COMPOSE_PROFILES=ledger-besu (docs/setup/besu.md)." >&2
    exit 1
  fi
  set -a
  . "$env"
  set +a
done

# The Besu ledger's commands run in the worker service: it alone holds the ledger signer key and
# reaches the node. The admin key comes on standard input, so never from a bare terminal, where
# it would be pasted and echoed.
service=api
case "${1:-}" in
  ledger-deploy | ledger-check | ledger-status)
    service=worker
    if [ "$1" = ledger-deploy ] && [ -t 0 ] && [[ " $* " != *" --admin "* ]]; then
      echo "ft.sh: give the admin key on standard input: ./scripts/ft.sh ledger-deploy < secrets/ledger_admin_key (or --admin 0x...)." >&2
      exit 2
    fi
    ;;
esac

exec docker compose --env-file deploy/.state/image.env -f deploy/compose.yml \
  run --rm --no-deps -T "$service" node apps/api/dist/cli.js "$@"
