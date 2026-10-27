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

# The production stack. LAN_IP (where AdGuard publishes port 53) comes from the file init.sh writes.
compose() {
  (
    if [ -f deploy/.state/network.env ]; then
      set -a
      # shellcheck source=/dev/null
      . deploy/.state/network.env
      set +a
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
