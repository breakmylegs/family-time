#!/usr/bin/env bash
# Starts or stops the stack as update.sh last deployed it. The systemd unit runs this at boot.
#
#   ./scripts/stack.sh up      ./scripts/stack.sh stop
#
# The same compose() as update.sh, so the deploy state (the LAN address, the ledger choice, which
# AdGuard, ADR 0022) is read and checked the same way, and the bundled AdGuard starts only when it
# was chosen. The deployed tag is read from deploy/.state/image.env, never run as shell.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/deploy-lib.sh
. scripts/lib/deploy-lib.sh

IMAGE_TAG=$(sed -nE 's/^IMAGE_TAG=([0-9a-f]{7,40}(-drill)?)$/\1/p' deploy/.state/image.env 2>/dev/null | tail -n 1)
[ -n "$IMAGE_TAG" ] || { echo "stack.sh: nothing is deployed yet. Run ./scripts/update.sh first." >&2; exit 1; }
export IMAGE_TAG

case ${1:-} in
  up) compose up -d ;;
  stop) compose stop ;;
  *) echo "stack.sh: up or stop" >&2; exit 2 ;;
esac
