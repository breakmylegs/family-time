#!/usr/bin/env bash
# Checks the running stack from the server (brief Part 15, ADR 0017):
#
#   ./scripts/verify.sh                                  inside the stack and on the LAN
#   ./scripts/verify.sh --url https://family.example.com and through Caddy, as a phone sees it
#
#   - /healthz, every /readyz check, and /version's commit is the one update.sh deployed
#   - the kiosk answers on the LAN address
#   - AdGuard's admin, Besu's RPC, Postgres and the kiosk's inner port do NOT answer from outside Docker
#   - with --url: the app over HTTPS, its security headers, and MCP saying it is off when it is
#
# Exit codes: 0 all green, 1 a finding, 2 the app could not be reached. Unreachable is never a pass.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/deploy-lib.sh
. scripts/lib/deploy-lib.sh

url=""
while [ $# -gt 0 ]; do
  case $1 in
    --url) url=${2:?--url needs the app address}; shift 2 ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "verify.sh: unknown option $1" >&2; exit 2 ;;
  esac
done
url=${url%/}

findings=0
pass() { printf '  ok    %s\n' "$*"; }
finding() { printf '  FAIL  %s\n' "$*"; findings=$((findings + 1)); }

IMAGE_TAG=$(state_read current)
export IMAGE_TAG
[ -n "$IMAGE_TAG" ] || { echo "verify.sh: nothing is deployed yet. Run ./scripts/update.sh first." >&2; exit 2; }
# shellcheck source=/dev/null
[ -f deploy/.state/network.env ] && . deploy/.state/network.env
lan=${LAN_IP:-127.0.0.1}

# A tiny HTTP client inside the api container: status and body, or nothing when there is no answer.
inside() {
  compose exec -T api node -e "fetch('http://127.0.0.1:3000$1').then(async r => { console.log(r.status); console.log(await r.text()) }, () => process.exit(3))" 2>/dev/null
}

# Is a TCP port open? Tests swap this for a fake through FT_PORT_PROBE.
port_open() {
  if [ -n "${FT_PORT_PROBE:-}" ]; then "$FT_PORT_PROBE" "$1" "$2"; return; fi
  timeout 2 bash -c ">/dev/tcp/$1/$2" 2>/dev/null
}

echo "verify.sh: the app, deployed as $IMAGE_TAG"
health=$(inside /healthz) || { echo "  FAIL  the api did not answer at all"; exit 2; }
[ "$(printf '%s\n' "$health" | head -n 1)" = 200 ] && pass "/healthz" || finding "/healthz answered $(printf '%s\n' "$health" | head -n 1)"

ready=$(inside /readyz) || { echo "  FAIL  /readyz did not answer"; exit 2; }
if [ "$(printf '%s\n' "$ready" | head -n 1)" = 200 ]; then
  pass "/readyz: every check passed"
else
  finding "/readyz is not ready: $(printf '%s\n' "$ready" | tail -n +2 | grep -oE '"name":"[a-z]+","ok":false[^}]*' | sed -E 's/"name":"([a-z]+)","ok":false,"detail":"([^"]*)".*/\1 (\2)/' | paste -sd ';' -)"
fi

version=$(inside /version) || { echo "  FAIL  /version did not answer"; exit 2; }
commit=$(printf '%s\n' "$version" | tail -n +2 | sed -nE 's/.*"commit":"([^"]+)".*/\1/p')
if [ "$commit" = "${IMAGE_TAG%-drill}" ]; then pass "/version: commit $commit"; else finding "/version says commit '$commit', but $IMAGE_TAG is deployed"; fi

echo "verify.sh: the kiosk"
kiosk_port=${KIOSK_HOST_PORT:-8180}
if command -v curl >/dev/null && [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$lan:$kiosk_port/")" = 200 ]; then
  pass "the kiosk answers on http://$lan:$kiosk_port"
else
  finding "the kiosk does not answer on http://$lan:$kiosk_port"
fi

echo "verify.sh: what must stay inside Docker"
for p in "3000 AdGuard's admin" "8545 Besu's RPC" "5432 Postgres" "3001 the kiosk listener inside the container"; do
  port=${p%% *}
  what=${p#* }
  closed=1
  for host in "$lan" 127.0.0.1; do port_open "$host" "$port" && closed=0; done
  [ "$closed" = 1 ] && pass "$what is not reachable on port $port" || finding "$what answers on port $port from outside Docker"
done
# Port 53 is meant to be open on the LAN address: it is the home DNS.
port_open "$lan" 53 && pass "home DNS answers on $lan:53" || finding "home DNS does not answer on $lan:53"

if [ -n "$url" ]; then
  echo "verify.sh: through Caddy at $url"
  headers=$(curl -s -D - -o /dev/null --max-time 10 "$url/healthz") || { echo "  FAIL  $url did not answer"; exit 2; }
  printf '%s' "$headers" | head -n 1 | grep -q ' 200' && pass "$url/healthz over HTTPS" || finding "$url/healthz answered $(printf '%s' "$headers" | head -n 1)"
  state=$(curl -s -D - -o /dev/null --max-time 10 "$url/api/auth/state")
  for h in x-content-type-options referrer-policy x-frame-options; do
    printf '%s' "$state" | grep -qi "^$h:" && pass "header $h" || finding "header $h is missing"
  done
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url/api/children")" = 401 ] && pass "signed-out requests are refused" || finding "$url/api/children did not refuse a signed-out request"
  mcp=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H 'content-type: application/json' -d '{}' "$url/mcp")
  case $mcp in 401 | 404) pass "/mcp needs a token, or says it is off ($mcp)" ;; *) finding "/mcp answered $mcp to a request with no token" ;; esac
fi

echo
if [ "$findings" = 0 ]; then echo "verify.sh: all green"; exit 0; fi
[ "$findings" = 1 ] && echo "verify.sh: 1 finding. Paste this output into the build chat." || echo "verify.sh: $findings findings. Paste this output into the build chat."
exit 1
