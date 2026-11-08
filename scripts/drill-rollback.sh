#!/usr/bin/env bash
# Proves the automatic rollback on this server. Builds the running commit again as an image that is
# never ready, deploys it, and checks that update.sh rolls back and the previous version still
# answers. Run it once after the first successful deploy, and after any change to update.sh.
#
#   cd /opt/family-time && ./scripts/drill-rollback.sh
#
# Takes as long as a normal deploy. Runs in the foreground; it is short enough to watch, and the
# deploy inside it holds the lock, so a dropped session leaves nothing half done.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

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

current=$(cat deploy/.state/current 2>/dev/null || true)
if [ -z "$current" ]; then
  echo "drill: nothing is deployed yet. Run ./scripts/update.sh first." >&2
  exit 2
fi
case "$current" in
  *-drill) echo "drill: the running version is a drill build ($current). Run ./scripts/update.sh first." >&2; exit 2 ;;
esac

echo "drill: running version is $current"
echo "drill: deploying a build that is never ready. update.sh should roll back to $current."
rc=0
FT_DRILL=1 FT_NO_PULL=1 ./scripts/update.sh -f || rc=$?

pass=1
check() {
  if eval "$2"; then
    echo "  PASS  $1"
  else
    echo "  FAIL  $1"
    pass=0
  fi
}

version=$(docker compose -f deploy/compose.yml --env-file deploy/.state/image.env exec -T api node -e \
  "fetch('http://127.0.0.1:3000/version').then(r=>r.text()).then(t=>process.stdout.write(t))" 2>/dev/null || true)
ready=$(docker compose -f deploy/compose.yml --env-file deploy/.state/image.env exec -T api node -e \
  "fetch('http://127.0.0.1:3000/readyz').then(r=>process.stdout.write(String(r.status)))" 2>/dev/null || true)

echo
echo "drill: results"
check "update.sh exited 21 (rolled back), got $rc" '[ "$rc" = 21 ]'
check "deploy state still names $current" '[ "$(cat deploy/.state/current)" = "$current" ]'
check "/version reports the previous commit ${current%-drill}" '[[ "$version" == *"\"commit\":\"${current}\""* ]]'
check "/readyz answers 200, got ${ready:-nothing}" '[ "$ready" = 200 ]'
check "no drill image left behind" '! docker image ls family-time --format "{{.Tag}}" | grep -q -- "-drill$"'

if [ "$pass" = 1 ]; then
  echo "drill: PASSED"
  exit 0
fi
echo "drill: FAILED. Read the newest log in .deploy/logs/"
exit 1
