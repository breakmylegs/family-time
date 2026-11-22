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
  if [ "$env" = deploy/.state/ledger.env ] && grep -Evq '^(#.*|LEDGER_ADAPTER=(postgres|besu)|COMPOSE_PROFILES=(ledger-besu|ai-local|ledger-besu,ai-local)|)$' "$env"; then
    echo "deploy/.state/ledger.env may only hold LEDGER_ADAPTER=postgres|besu and COMPOSE_PROFILES=ledger-besu, ai-local or ledger-besu,ai-local (docs/setup/besu.md, docs/setup/ai-and-mcp.md)." >&2
    exit 1
  fi
  set -a
  . "$env"
  set +a
done

# Which AdGuard (ADR 0022), read without running the file, as update.sh reads it.
# shellcheck source=lib/deploy-lib.sh
. scripts/lib/deploy-lib.sh
ag_rc=0
load_adguard_env || ag_rc=$?
if [ "$ag_rc" = 1 ]; then
  echo "ft.sh: deploy/.state/adguard.env is missing. Run ./scripts/init.sh, which asks which AdGuard to use." >&2
  exit 1
fi
[ "$ag_rc" = 0 ] || exit 1
export ADGUARD_MODE ADGUARD_URL ADGUARD_USER ADGUARD_ALLOW_UNTESTED ADGUARD_CA_FILE
[ "$ADGUARD_MODE" = bundled ] && export COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}adguard-bundled"

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

# Local AI (the ai-local profile): download a model into the ollama-models volume, for example
#   ./scripts/ft.sh ollama-pull llama3.2
# A one-off container does the download, so the Ollama the api uses never has a way out.
if [ "${1:-}" = ollama-pull ]; then
  model="${2:-}"
  if ! [[ "$model" =~ ^[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$ ]]; then
    echo "ft.sh: give a model name, for example ./scripts/ft.sh ollama-pull llama3.2" >&2
    exit 2
  fi
  # Ollama's cloud models send what they are asked to ollama.com: never on a local profile.
  if [[ "$model" == *cloud* ]]; then
    echo "ft.sh: $model runs in Ollama's cloud, not on this server. Choose a local model, such as llama3.2." >&2
    exit 2
  fi
  if [[ ",${COMPOSE_PROFILES:-}," != *,ai-local,* ]]; then
    echo "ft.sh: local AI is off. Add ai-local to COMPOSE_PROFILES in deploy/.state/ledger.env, run ./scripts/update.sh, then try again (docs/setup/ai-and-mcp.md)." >&2
    exit 1
  fi
  exec docker compose --env-file deploy/.state/image.env -f deploy/compose.yml \
    run --rm --no-deps -T -e MODEL="$model" ollama-pull
fi

# Besu again from its allowlist step, after deploy/besu/admin-allowlist is added or removed
# (docs/setup/besu.md, if the signer key is ever stolen).
if [ "${1:-}" = besu-restart ]; then
  if [[ ",${COMPOSE_PROFILES:-}," != *,ledger-besu,* ]]; then
    echo "ft.sh: the Besu ledger is off, so there is nothing to restart (docs/setup/besu.md)." >&2
    exit 1
  fi
  exec docker compose --env-file deploy/.state/image.env -f deploy/compose.yml \
    up -d --force-recreate besu-allowlist besu
fi

# Once a contract is deployed the admin key's work is done: init.sh stops making it, and the owner
# moves it offline (docs/setup/besu.md).
if [ "${1:-}" = ledger-deploy ]; then
  docker compose --env-file deploy/.state/image.env -f deploy/compose.yml \
    run --rm --no-deps -T "$service" node apps/api/dist/cli.js "$@"
  echo "LEDGER_ADMIN_USED=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > deploy/.state/ledger-admin.env
  if [ -e secrets/ledger_admin_key ]; then
    echo "ft.sh: the contract is deployed. Now move secrets/ledger_admin_key somewhere offline and delete it from the server; nothing here needs it again."
  fi
  exit 0
fi

exec docker compose --env-file deploy/.state/image.env -f deploy/compose.yml \
  run --rm --no-deps -T "$service" node apps/api/dist/cli.js "$@"
