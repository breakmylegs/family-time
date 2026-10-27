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

if [ -f deploy/.state/network.env ]; then
  set -a
  . deploy/.state/network.env
  set +a
fi

exec docker compose --env-file deploy/.state/image.env -f deploy/compose.yml \
  run --rm --no-deps -T api node apps/api/dist/cli.js "$@"
