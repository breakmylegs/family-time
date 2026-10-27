#!/usr/bin/env bash
# Deploys the newest commit of the checked-out branch from origin. The only way to deploy.
# The server tracks main; during a phase it may track that phase's branch until it is merged.
#
#   cd /opt/family-time && ./scripts/update.sh
#
# It detaches by default, so a dropped SSH session cannot kill a deploy halfway. It prints the log
# path and follows it; Ctrl-C stops the following, not the deploy. `-f` runs in the foreground.
#
# Steps
#   1  preflight   on a branch with an upstream, clean tree, secrets, Docker and the proxy network
#   2  lock        one deploy at a time
#   3  pull        fast-forward to origin/<branch>; if this script changed, re-run the new one
#   4  build       the test image and the runtime image, tagged with the commit
#   5  gate        the whole gate inside the test image, with no network
#   6  pg tests    the real-Postgres tests in a throwaway Compose project
#   7  snapshot    pg_dump of the live database, checked for size
#   8  migrate     additive migrations only, so the running version keeps working
#   9  start       new api and worker, wait for their health checks
#  10  verify      /version must report the commit just built
#  11  finish      record the deployed tag, prune old images; or roll back to the previous tag
#
# Nothing live changes before step 8. Exit codes are listed in scripts/lib/deploy-lib.sh.
#
# Environment (for the rollback drill and the tests, not for everyday use):
#   FT_NO_PULL=1  deploy what is checked out, without pulling
#   FT_DRILL=1 build an image that is never ready, to prove the rollback

# Everything runs inside main(), which bash reads in full before running any of it. Without that,
# a `git pull` that changes this file mid-run would make bash read the rest from the new file.
main() {
  set -Eeuo pipefail
  local root
  root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  cd "$root"
  # shellcheck source=lib/deploy-lib.sh
  source scripts/lib/deploy-lib.sh

  local foreground=0
  for arg in "$@"; do
    case $arg in
      -f|--foreground) foreground=1 ;;
      -h|--help) sed -n '2,30p' "$0"; return 0 ;;
      *) echo "update.sh: unknown option $arg (try -h)" >&2; return "$EXIT_PREFLIGHT" ;;
    esac
  done

  mkdir -p .deploy/logs
  if [ "$foreground" = 0 ] && [ -z "${FT_DETACHED:-}" ]; then
    detach "$@"
    return $?
  fi

  export FT_LOG=${FT_LOG:-$root/.deploy/logs/update-$(date -u +%Y%m%dT%H%M%SZ).log}
  : >> "$FT_LOG"

  LOCK_HELD=0
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  deploy
}

# Starts this script again in its own session, writes where the log is, and follows it until the
# deploy ends. Returns the deploy's own exit code.
detach() {
  local log status pid
  log="$PWD/.deploy/logs/update-$(date -u +%Y%m%dT%H%M%SZ).log"
  status="$PWD/.deploy/last-exit"
  rm -f "$status"
  : > "$log"
  if ! command -v setsid >/dev/null; then
    echo "update.sh: setsid is not available, running in the foreground." >&2
    FT_DETACHED=1 FT_LOG="$log" bash "$0" -f
    return $?
  fi
  FT_DETACHED=1 FT_LOG="$log" setsid nohup bash "$0" -f > /dev/null 2>&1 < /dev/null &
  pid=$!
  echo "update.sh: deploying in the background (pid $pid)."
  echo "update.sh: log $log"
  echo "update.sh: Ctrl-C stops following; the deploy carries on. Follow again with: tail -f $log"
  tail -n +1 -f --pid="$pid" "$log" 2>/dev/null || true
  while kill -0 "$pid" 2>/dev/null; do sleep 1; done
  if [ -s "$status" ]; then
    return "$(cat "$status")"
  fi
  echo "update.sh: the deploy ended without writing its status. Read $log" >&2
  return 1
}

on_exit() {
  local rc=$?
  if [ "$LOCK_HELD" = 1 ]; then
    rm -rf .deploy/lock
  fi
  mkdir -p .deploy
  printf '%s\n' "$rc" > .deploy/last-exit
  log "finished: exit $rc, $(exit_meaning "$rc")"
  if [ "$rc" -ne 0 ] && [ "$rc" -ne "$EXIT_LOCKED" ]; then
    log "log: $FT_LOG"
  fi
}

fail() {
  local code=$1
  shift
  log "FAILED: $*"
  exit "$code"
}

deploy() {
  local branch
  local drill=${FT_DRILL:-0}

  # 1 preflight
  log "1/11 preflight"
  command -v docker >/dev/null || fail "$EXIT_PREFLIGHT" "docker is not installed"
  docker compose version >/dev/null 2>&1 || fail "$EXIT_PREFLIGHT" "docker compose v2 is not available"
  git rev-parse --git-dir >/dev/null 2>&1 || fail "$EXIT_PREFLIGHT" "$PWD is not a git checkout"
  branch=$(git symbolic-ref --quiet --short HEAD || true)
  [ -n "$branch" ] || fail "$EXIT_PREFLIGHT" "the checkout is on a detached HEAD. Run: git checkout main"
  [ "$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" = "origin/$branch" ] || fail "$EXIT_PREFLIGHT" "branch $branch does not track origin/$branch. Run: git branch --set-upstream-to=origin/$branch"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || fail "$EXIT_PREFLIGHT" "the checkout has local changes. Deploy only what is on origin: git status"
  [ -s secrets/postgres_password ] || fail "$EXIT_PREFLIGHT" "secrets are missing. Run ./scripts/init.sh first"
  # Added in later versions; init.sh is safe to run again and only adds what is missing.
  [ -s secrets/adguard_password ] && [ -s deploy/.state/network.env ]     || fail "$EXIT_PREFLIGHT" "this version needs new setup (the AdGuard password and the LAN address). Run ./scripts/init.sh again"
  local proxy_net=${PROXY_NETWORK:-proxy_net}
  docker network inspect "$proxy_net" >/dev/null 2>&1 \
    || fail "$EXIT_PREFLIGHT" "Docker network $proxy_net does not exist. It is the network your Caddy uses: docker network create $proxy_net"

  # 2 lock. Taken after preflight, so a refused run never touches it. No stale-lock clearing:
  # if a deploy died, read its log, then remove .deploy/lock by hand.
  log "2/11 lock"
  if [ "${FT_LOCK_INHERITED:-0}" = 1 ]; then
    LOCK_HELD=1
  elif mkdir .deploy/lock 2>/dev/null; then
    LOCK_HELD=1
    printf 'pid %s\nstarted %s\nlog %s\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$FT_LOG" > .deploy/lock/owner
  else
    log "another deploy holds .deploy/lock:"
    sed 's/^/    /' .deploy/lock/owner 2>/dev/null || true
    log "if no deploy is running, read its log, then: rm -rf .deploy/lock"
    exit "$EXIT_LOCKED"
  fi

  # 3 pull, then re-run the new script if the pull changed it.
  log "3/11 pull"
  if [ "${FT_NO_PULL:-0}" = 1 ] || [ -n "${FT_REEXEC:-}" ]; then
    log "skipping pull"
  else
    local before after
    before=$(cat scripts/update.sh scripts/lib/deploy-lib.sh | sha256sum)
    run_logged git fetch --quiet origin "$branch" || fail "$EXIT_PULL" "git fetch failed"
    run_logged git merge --ff-only "origin/$branch" || fail "$EXIT_PULL" "cannot fast-forward to origin/$branch"
    after=$(cat scripts/update.sh scripts/lib/deploy-lib.sh | sha256sum)
    if [ "$before" != "$after" ]; then
      log "update.sh changed in this pull; running the new version"
      LOCK_HELD=0
      trap - EXIT
      FT_REEXEC=1 FT_LOCK_INHERITED=1 FT_LOG="$FT_LOG" FT_DETACHED=1 exec bash scripts/update.sh -f
    fi
  fi

  local commit tag built_at previous
  commit=$(git rev-parse --short=12 HEAD)
  tag=$commit
  [ "$drill" = 1 ] && tag="$commit-drill"
  built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  previous=$(state_read current)
  log "deploying $tag (running now: ${previous:-nothing})"

  # 4 build
  log "4/11 build (output in the log)"
  run_logged docker build --target test -t "family-time:test-$tag" . \
    || fail "$EXIT_BUILD" "the test image did not build"
  run_logged docker build \
    --build-arg "GIT_COMMIT=$commit" \
    --build-arg "BUILD_TIME=$built_at" \
    --build-arg "FT_DRILL_UNREADY=$drill" \
    -t "family-time:$tag" . \
    || fail "$EXIT_BUILD" "the runtime image did not build"

  # 5 gate, with no network
  log "5/11 gate in the test image"
  run_logged docker run --rm --network none "family-time:test-$tag" \
    || fail "$EXIT_GATE" "the gate failed. Nothing live changed"

  # 6 real-Postgres tests in a throwaway project
  log "6/11 real-Postgres tests"
  local pg_rc=0
  IMAGE_TAG=$tag run_logged compose_test up --abort-on-container-exit --exit-code-from tests || pg_rc=$?
  IMAGE_TAG=$tag run_logged compose_test down -v --remove-orphans || true
  [ "$pg_rc" = 0 ] || fail "$EXIT_PGTESTS" "the real-Postgres tests failed. Nothing live changed"

  # 7 snapshot the live database, if there is one
  log "7/11 snapshot"
  if [ -n "$(IMAGE_TAG=${previous:-none} compose ps --status running -q postgres 2>/dev/null)" ]; then
    mkdir -p backups/pre-deploy
    local dump size
    dump="backups/pre-deploy/$(date -u +%Y%m%dT%H%M%SZ)-before-$tag.dump"
    IMAGE_TAG=${previous:-none} compose exec -T postgres pg_dump -U family_time -d family_time --format=custom > "$dump" \
      || { rm -f "$dump"; fail "$EXIT_SNAPSHOT" "pg_dump failed"; }
    size=$(wc -c < "$dump")
    # An empty custom-format dump is still about 1 KB of headers, so anything smaller is broken.
    [ "$size" -ge 1024 ] || { rm -f "$dump"; fail "$EXIT_SNAPSHOT" "the dump is only $size bytes"; }
    log "dumped $size bytes to $dump"
    # Keep the newest ten.
    ls -1t backups/pre-deploy/*.dump 2>/dev/null | tail -n +11 | xargs -r rm -f
  else
    log "no running database yet, nothing to dump"
  fi

  # 8 migrate
  log "8/11 migrate"
  IMAGE_TAG=$tag run_logged compose run --rm migrate \
    || fail "$EXIT_MIGRATE" "a migration failed. The running version is untouched"

  # 9 start and 10 verify. From here a failure rolls back.
  log "9/11 start"
  if ! start_and_wait "$tag"; then
    roll_back "$previous" "$tag" "the new version did not become healthy"
  fi

  log "10/11 verify"
  local version
  version=$(IMAGE_TAG=$tag compose exec -T api node -e \
    "fetch('http://127.0.0.1:3000/version').then(r=>r.text()).then(t=>process.stdout.write(t))" 2>>"$FT_LOG" || true)
  if [[ "$version" != *"\"commit\":\"$commit\""* ]]; then
    log "/version answered: ${version:-nothing}"
    roll_back "$previous" "$tag" "/version does not report $commit"
  fi

  # 11 finish
  log "11/11 finish"
  if [ -n "$previous" ] && [ "$previous" != "$tag" ]; then
    state_write previous "$previous"
  fi
  state_write current "$tag"
  state_write image.env "IMAGE_TAG=$tag"
  prune "$tag" "$(state_read previous)"
  log "deployed $tag"
}

# start_and_wait TAG: starts the api and worker on TAG, then polls the api's own health check
# (which calls /readyz) until it is healthy, unhealthy, or three minutes pass. Not `up --wait`,
# whose handling of a one-shot dependency like migrate has changed between Compose versions.
start_and_wait() {
  local tag=$1 api worker status i
  IMAGE_TAG=$tag run_logged compose up -d api worker || return 1
  api=$(IMAGE_TAG=$tag compose ps -q api 2>>"$FT_LOG" || true)
  worker=$(IMAGE_TAG=$tag compose ps -q worker 2>>"$FT_LOG" || true)
  if [ -z "$api" ] || [ -z "$worker" ]; then
    log "the api or worker container did not start"
    return 1
  fi
  for i in $(seq 1 90); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$api" 2>>"$FT_LOG" || echo missing)
    case $status in
      healthy) break ;;
      unhealthy|missing) log "api is $status"; return 1 ;;
      # No health check is never a pass.
      none) log "the api container has no health check"; return 1 ;;
    esac
    [ $((i % 10)) = 0 ] && log "waiting for the api to be healthy ($((i * 2))s)"
    sleep 2
  done
  [ "$status" = healthy ] || { log "api not healthy after 180s (last status: $status)"; return 1; }
  if [ "$(docker inspect -f '{{.State.Running}}' "$worker" 2>>"$FT_LOG")" != true ]; then
    log "the worker is not running"
    return 1
  fi
  return 0
}

# roll_back PREVIOUS_TAG FAILED_TAG REASON: puts the previous images back. Never touches the
# database: the migrations are additive, so the previous version runs on the new schema.
roll_back() {
  local previous=$1 failed=$2 reason=$3
  log "FAILED: $reason"
  if [ -z "$previous" ]; then
    log "first deploy, nothing to roll back to. Stopping the api and worker."
    IMAGE_TAG=none run_logged compose stop api worker || true
    exit "$EXIT_FIRST_FAILED"
  fi
  log "rolling back to $previous"
  if start_and_wait "$previous"; then
    log "rolled back to $previous, which is healthy"
    run_logged docker image rm "family-time:$failed" "family-time:test-$failed" || true
    exit "$EXIT_ROLLED_BACK"
  fi
  log "the rollback to $previous is not healthy either"
  exit "$EXIT_ROLLBACK_FAILED"
}

# prune KEEP...: removes family-time images except the tags given, and every test image.
prune() {
  local keep=" $* " t
  while read -r t; do
    [ -n "$t" ] || continue
    case "$keep" in
      *" $t "*) ;;
      *) run_logged docker image rm "family-time:$t" || true ;;
    esac
  done < <(docker image ls family-time --format '{{.Tag}}' 2>/dev/null)
}

main "$@"
exit $?
