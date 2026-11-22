# Helpers for scripts/update.sh. Sourced, never run.
# shellcheck shell=bash

# Exit codes. Each failure has its own, so a log line or a monitoring check can tell them apart.
readonly EXIT_OK=0
readonly EXIT_PREFLIGHT=10      # not ready to deploy (wrong branch, dirty tree, no secrets, no Docker)
readonly EXIT_LOCKED=11         # another deploy is running
readonly EXIT_PULL=12           # could not fast-forward to origin
readonly EXIT_BUILD=13          # an image failed to build
readonly EXIT_GATE=14           # the gate failed inside the test image. Nothing live changed
readonly EXIT_PGTESTS=15        # the real-Postgres tests failed. Nothing live changed
readonly EXIT_SNAPSHOT=16       # the pre-deploy database dump failed or was too small
readonly EXIT_MIGRATE=17        # a migration failed. The running version is untouched
readonly EXIT_ROLLED_BACK=21    # the new version was not healthy; the previous one is running again
readonly EXIT_ROLLBACK_FAILED=22  # ... and the rollback failed too. The site is down
readonly EXIT_FIRST_FAILED=23   # first deploy was not healthy; nothing to roll back to, stack stopped
readonly EXIT_INTERRUPTED_INT=130
readonly EXIT_INTERRUPTED_TERM=143

exit_meaning() {
  case $1 in
    0) echo "deployed" ;;
    10) echo "preflight failed, nothing changed" ;;
    11) echo "another deploy is running, nothing changed" ;;
    12) echo "pull failed, nothing changed" ;;
    13) echo "build failed, nothing changed" ;;
    14) echo "gate failed in the test image, nothing changed" ;;
    15) echo "real-Postgres tests failed, nothing changed" ;;
    16) echo "pre-deploy database dump failed, nothing changed" ;;
    17) echo "migration failed, the running version is untouched" ;;
    21) echo "new version unhealthy, ROLLED BACK to the previous version" ;;
    22) echo "new version unhealthy and the ROLLBACK FAILED. The site is down" ;;
    23) echo "first deploy unhealthy, nothing to roll back to, stack stopped" ;;
    130|143) echo "interrupted" ;;
    *) echo "unexpected exit" ;;
  esac
}

# Logs go to the terminal and to the run's log file. Command output goes to the log file only,
# and its tail is shown when a step fails.
log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) update: $*"
  printf '%s\n' "$line"
  [ -n "${FT_LOG:-}" ] && printf '%s\n' "$line" >> "$FT_LOG"
  return 0
}

# run_logged CMD...: runs a command with its output in the log file. Returns its exit code.
run_logged() {
  local rc=0
  printf '\n$ %s\n' "$*" >> "$FT_LOG"
  "$@" >> "$FT_LOG" 2>&1 || rc=$?
  if [ "$rc" -ne 0 ]; then
    log "command failed (exit $rc): $*"
    log "last lines of $FT_LOG:"
    tail -n 25 "$FT_LOG" | sed 's/^/    /'
  fi
  return "$rc"
}

# Which AdGuard Family time uses (ADR 0022). Keep in step with TESTED_VERSION in
# packages/adguard-client/src/version.ts; a test checks they match.
ADGUARD_TESTED=0.107.79
readonly BUNDLED_ADGUARD_URL=http://adguard:3000

# Reads deploy/.state/adguard.env without running it, like backup.env: only these keys, each in a
# known shape, so the file can never run a command.
#   ADGUARD_MODE=external|bundled  ADGUARD_URL=http(s)://host[:port]  ADGUARD_USER=name
#   ADGUARD_CA=0|1 (trust secrets/adguard_ca.pem, for AdGuard only)  ADGUARD_ALLOW_UNTESTED=0|1
# Sets those, and ADGUARD_CA_FILE, the certificate's path inside the containers, which only the
# AdGuard client uses. Returns 1 when there is no file, 2 when it is wrong.
load_adguard_env() {
  local file=${1:-deploy/.state/adguard.env} key value
  ADGUARD_MODE="" ADGUARD_URL="" ADGUARD_USER="" ADGUARD_CA=0 ADGUARD_ALLOW_UNTESTED=0 ADGUARD_CA_FILE=""
  [ -s "$file" ] || return 1
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case $key in
      '' | '#'*) continue ;;
      ADGUARD_MODE) [[ "$value" =~ ^(external|bundled)$ ]] || { echo "$file: ADGUARD_MODE is external or bundled" >&2; return 2; } ;;
      ADGUARD_URL) [[ "$value" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$ ]] || { echo "$file: ADGUARD_URL is the address of AdGuard's web page, like http://192.168.1.2:3000 or https://adguard.home.example (no path)" >&2; return 2; } ;;
      ADGUARD_USER) [[ "$value" =~ ^[A-Za-z0-9._@-]{1,64}$ ]] || { echo "$file: ADGUARD_USER may hold letters, digits and . _ @ - only" >&2; return 2; } ;;
      ADGUARD_CA | ADGUARD_ALLOW_UNTESTED) [[ "$value" =~ ^[01]$ ]] || { echo "$file: $key is 0 or 1" >&2; return 2; } ;;
      *) echo "$file may only hold ADGUARD_MODE, ADGUARD_URL, ADGUARD_USER, ADGUARD_CA and ADGUARD_ALLOW_UNTESTED (docs/setup/network.md)" >&2; return 2 ;;
    esac
    printf -v "$key" '%s' "$value"
  done < "$file"
  [ -n "$ADGUARD_MODE" ] && [ -n "$ADGUARD_URL" ] && [ -n "$ADGUARD_USER" ] || { echo "$file needs ADGUARD_MODE, ADGUARD_URL and ADGUARD_USER. Run ./scripts/init.sh again" >&2; return 2; }
  ADGUARD_URL=${ADGUARD_URL%/}
  if [ "$ADGUARD_MODE" = bundled ] && [ "$ADGUARD_URL" != "$BUNDLED_ADGUARD_URL" ]; then
    echo "$file: the bundled AdGuard is always at $BUNDLED_ADGUARD_URL" >&2
    return 2
  fi
  if [ "$ADGUARD_CA" = 1 ]; then
    [[ "$ADGUARD_URL" == https://* ]] || { echo "$file: ADGUARD_CA=1 is only for an https ADGUARD_URL" >&2; return 2; }
    [ -s secrets/adguard_ca.pem ] || { echo "$file: ADGUARD_CA=1, but secrets/adguard_ca.pem is empty. Put AdGuard's certificate there (docs/setup/network.md)" >&2; return 2; }
    ADGUARD_CA_FILE=/run/app-secrets/adguard_ca.pem
  fi
  return 0
}

# adguard_verdict VERSION ALLOW_UNTESTED: "ok", "warn MESSAGE" or "refuse MESSAGE", by the same rules
# as checkVersion in packages/adguard-client/src/version.ts.
adguard_verdict() {
  local version=$1 allow=$2 t_major t_minor t_patch major minor patch shown
  IFS=. read -r t_major t_minor t_patch <<< "$ADGUARD_TESTED"
  if ! [[ "$version" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    [ "$allow" = 1 ] && { echo "warn AdGuard reported its version as '$version', which Family time cannot read. Going ahead because ADGUARD_ALLOW_UNTESTED=1."; return; }
    echo "refuse AdGuard reported its version as '$version', which Family time cannot read. It is tested with v$ADGUARD_TESTED."
    return
  fi
  major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]} patch=${BASH_REMATCH[3]}
  shown="v$major.$minor.$patch"
  if [ "$major" = "$t_major" ] && [ "$minor" = "$t_minor" ] && [ "$patch" -ge "$t_patch" ]; then
    [ "$patch" = "$t_patch" ] && { echo ok; return; }
    echo "warn AdGuard is $shown, newer than the tested v$ADGUARD_TESTED in the same series. That is supported; every change is read back to check it held."
    return
  fi
  if [ "$major" -lt "$t_major" ] || { [ "$major" = "$t_major" ] && [ "$minor" -lt "$t_minor" ]; } || { [ "$major" = "$t_major" ] && [ "$minor" = "$t_minor" ]; }; then
    echo "refuse AdGuard is $shown, older than v$ADGUARD_TESTED, the version Family time is tested with. Update AdGuard Home, then run this again."
    return
  fi
  [ "$allow" = 1 ] && { echo "warn AdGuard is $shown, a newer series than the tested v$ADGUARD_TESTED. Going ahead because ADGUARD_ALLOW_UNTESTED=1: watch Control for devices that show Not confirmed."; return; }
  echo "refuse AdGuard is $shown, a newer series than the tested v$ADGUARD_TESTED, and its API may have changed. Wait for a Family time update, or accept the risk by adding ADGUARD_ALLOW_UNTESTED=1 to deploy/.state/adguard.env."
}

# adguard_check: for an external AdGuard, from this server: can it be reached, does the login work,
# and is its version one Family time supports. Prints "warn ..." lines to pass on, or the problem.
# The password goes to curl on standard input, never on its command line. Load adguard.env first.
adguard_check() {
  local body err code rc=0 pw version verdict cacert=()
  body=$(mktemp) err=$(mktemp)
  pw=$(cat secrets/adguard_password 2>/dev/null)
  [ -n "$pw" ] || { rm -f "$body" "$err"; echo "secrets/adguard_password is empty. Run ./scripts/init.sh --adguard-new-password"; return 1; }
  [ "$ADGUARD_CA" = 1 ] && cacert=(--cacert secrets/adguard_ca.pem)
  esc() { local s=${1//\\/\\\\}; printf '%s' "${s//\"/\\\"}"; }
  # -q first: root's ~/.curlrc is never read. --noproxy: the login never goes through a proxy.
  code=$(printf 'user = "%s:%s"\n' "$(esc "$ADGUARD_USER")" "$(esc "$pw")" \
    | curl -q -sS --noproxy '*' --max-time 10 -K - "${cacert[@]}" -o "$body" -w '%{http_code}' "$ADGUARD_URL/control/status" 2>"$err") || rc=$?
  if [ "$rc" != 0 ]; then
    case $rc in
      35 | 51 | 58 | 60) echo "AdGuard at $ADGUARD_URL has a certificate this server does not trust ($(head -c 200 "$err" | tr -cd '[:print:]')). For a self-signed certificate, put it in secrets/adguard_ca.pem and set ADGUARD_CA=1 in deploy/.state/adguard.env (docs/setup/network.md)." ;;
      *) echo "could not reach AdGuard at $ADGUARD_URL from this server ($(head -c 200 "$err" | tr -cd '[:print:]')). Check the address in deploy/.state/adguard.env, and that AdGuard's web page answers from this server's network." ;;
    esac
    rm -f "$body" "$err"
    return 1
  fi
  case $code in
    200) ;;
    401 | 403) rm -f "$body" "$err"; echo "AdGuard at $ADGUARD_URL refused the login for user $ADGUARD_USER. Check the user in AdGuard and the password: ./scripts/init.sh --adguard-new-password replaces it."; return 1 ;;
    301 | 302 | 303 | 307 | 308) rm -f "$body" "$err"; echo "AdGuard at $ADGUARD_URL is not set up yet, or redirects elsewhere. Finish its own setup in its web page first; Family time never runs it on an AdGuard it does not run itself."; return 1 ;;
    *) rm -f "$body" "$err"; echo "AdGuard at $ADGUARD_URL answered HTTP $code to /control/status. Is ADGUARD_URL the address of AdGuard's web page?"; return 1 ;;
  esac
  version=$(sed -nE 's/.*"version":"([^"]*)".*/\1/p' "$body" | head -n 1)
  # Only the characters a version has, so nothing from the network reaches the terminal as is.
  version=${version//[^0-9A-Za-z.+-]/}
  version=${version:0:40}
  rm -f "$body" "$err"
  verdict=$(adguard_verdict "$version" "$ADGUARD_ALLOW_UNTESTED")
  case $verdict in
    ok) return 0 ;;
    warn\ *) echo "$verdict"; return 0 ;;
    *) echo "${verdict#refuse }"; return 1 ;;
  esac
}

# The production stack. LAN_IP (the kiosk's address, and where the bundled AdGuard publishes port 53)
# comes from network.env; the ledger choice (LEDGER_ADAPTER and COMPOSE_PROFILES) from ledger.env, if
# the owner made one; the AdGuard choice from adguard.env, which adds the adguard-bundled profile.
compose() {
  (
    for env in deploy/.state/network.env deploy/.state/ledger.env; do
      [ -f "$env" ] || continue
    # Only the settings each is for, checked before the shell reads them, so neither can run a
    # command or change IMAGE_TAG or anything else.
    if [ "$env" = deploy/.state/network.env ] && grep -Evq '^(#.*|LAN_IP=[0-9]{1,3}(\.[0-9]{1,3}){3}|KIOSK_HOST_PORT=[0-9]{2,5}|)$' "$env"; then
      echo "deploy/.state/network.env may only hold LAN_IP=<the server's LAN address> and KIOSK_HOST_PORT=<port>." >&2
      exit 1
    fi
    if [ "$env" = deploy/.state/ledger.env ] && grep -Evq '^(#.*|LEDGER_ADAPTER=(postgres|besu)|COMPOSE_PROFILES=(ledger-besu|ai-local|ledger-besu,ai-local)|)$' "$env"; then
      echo "deploy/.state/ledger.env may only hold LEDGER_ADAPTER=postgres|besu and COMPOSE_PROFILES=ledger-besu, ai-local or ledger-besu,ai-local (docs/setup/besu.md, docs/setup/ai-and-mcp.md)." >&2
      exit 1
    fi
      set -a
      # shellcheck source=/dev/null
      . "$env"
      set +a
    done
    local rc=0
    load_adguard_env || rc=$?
    [ "$rc" = 1 ] && { echo "deploy/.state/adguard.env is missing: run ./scripts/init.sh, which asks which AdGuard to use (docs/setup/network.md)." >&2; exit 1; }
    [ "$rc" = 0 ] || exit 1
    export ADGUARD_MODE ADGUARD_URL ADGUARD_USER ADGUARD_ALLOW_UNTESTED ADGUARD_CA_FILE
    if [ "$ADGUARD_MODE" = bundled ]; then
      export COMPOSE_PROFILES="${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}adguard-bundled"
    fi
    docker compose -f deploy/compose.yml "$@"
  )
}

compose_test() {
  docker compose -f deploy/compose.test.yml "$@"
}

state_read() {
  local file="deploy/.state/$1"
  [ -s "$file" ] && cat "$file" || true
}

state_write() {
  mkdir -p deploy/.state
  printf '%s\n' "$2" > "deploy/.state/$1.tmp"
  mv "deploy/.state/$1.tmp" "deploy/.state/$1"
}
