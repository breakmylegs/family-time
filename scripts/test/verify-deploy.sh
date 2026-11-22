#!/usr/bin/env bash
# Scenario tests for scripts/update.sh, with a fake docker and real git. Each case gets its own
# throwaway origin and server checkout, runs update.sh, and checks the exit code AND what the
# script did (which docker calls it made, what state it left). An exit code alone would count a
# syntax error as a pass.
#
#   bash scripts/test/verify-deploy.sh
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SHIMS="$REPO/scripts/test/shims"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
GIT=(git -c user.name=test -c user.email=test@example.invalid -c init.defaultBranch=main -c advice.detachedHead=false -c core.autocrlf=false)

passed=0
failed=0
cases=0

# A template origin and server checkout, copied for each case.
make_template() {
  local t="$WORK/template"
  mkdir -p "$t/seed"
  "${GIT[@]}" init -q --bare "$t/origin.git"
  mkdir -p "$t/seed/scripts/lib" "$t/seed/deploy"
  cp "$REPO/scripts/update.sh" "$t/seed/scripts/"
  cp "$REPO/scripts/lib/deploy-lib.sh" "$t/seed/scripts/lib/"
  cp "$REPO/deploy/compose.yml" "$REPO/deploy/compose.test.yml" "$t/seed/deploy/"
  cp "$REPO/.gitignore" "$REPO/.gitattributes" "$t/seed/"
  "${GIT[@]}" -C "$t/seed" init -q
  "${GIT[@]}" -C "$t/seed" add -A
  "${GIT[@]}" -C "$t/seed" commit -q -m seed
  "${GIT[@]}" -C "$t/seed" push -q "$t/origin.git" HEAD:main
  "${GIT[@]}" clone -q -c core.autocrlf=false "$t/origin.git" "$t/host"
  mkdir -p "$t/host/secrets" "$t/host/deploy/.state"
  echo pw > "$t/host/secrets/postgres_password"
  # Easy to spot, so a test can show it never reaches a command line.
  echo s3cret-adguard-pw > "$t/host/secrets/adguard_password"
  echo pem > "$t/host/secrets/vapid_private.pem"
  echo pub > "$t/host/secrets/vapid_public.txt"
  echo key > "$t/host/secrets/ledger_signer_key"
  echo key > "$t/host/secrets/besu_node_key"
  echo key > "$t/host/secrets/master_key"
  echo LAN_IP=192.0.2.10 > "$t/host/deploy/.state/network.env"
  # The default since ADR 0022: the household's own AdGuard elsewhere on the home network.
  external_adguard "$t/host"
}

# external_adguard HOST [URL] [CA] [ALLOW_UNTESTED] / bundled_adguard HOST: the AdGuard choice.
external_adguard() {
  printf 'ADGUARD_MODE=external\nADGUARD_URL=%s\nADGUARD_USER=familytime\nADGUARD_CA=%s\nADGUARD_ALLOW_UNTESTED=%s\n' \
    "${2:-http://192.0.2.53:3000}" "${3:-0}" "${4:-0}" > "$1/deploy/.state/adguard.env"
}
bundled_adguard() {
  printf 'ADGUARD_MODE=bundled\nADGUARD_URL=http://adguard:3000\nADGUARD_USER=familytime\nADGUARD_CA=0\nADGUARD_ALLOW_UNTESTED=0\n' > "$1/deploy/.state/adguard.env"
}

# new_case NAME: a fresh copy of the template. Sets C (case dir) and H (server checkout).
new_case() {
  cases=$((cases + 1))
  CASE_NAME=$1
  C="$WORK/case$cases"
  cp -r "$WORK/template" "$C"
  H="$C/host"
  git -C "$H" remote set-url origin "$C/origin.git"
  : > "$C/calls.log"
  CASE_OK=1
}

head12() { git -C "$1" rev-parse --short=12 HEAD; }

# push_commit [FILE TEXT]: a new commit on origin, made from the seed.
push_commit() {
  local file=${1:-CHANGE} text=${2:-change}
  "${GIT[@]}" -C "$C/seed" pull -q "$C/origin.git" main 2>/dev/null || true
  printf '%s\n' "$text" >> "$C/seed/$file"
  "${GIT[@]}" -C "$C/seed" add -A
  "${GIT[@]}" -C "$C/seed" commit -q -m "change $file"
  "${GIT[@]}" -C "$C/seed" push -q "$C/origin.git" HEAD:main
}

# push_commit_to BRANCH: a new commit on that origin branch.
push_commit_to() {
  "${GIT[@]}" -C "$C/seed" fetch -q "$C/origin.git" "$1"
  "${GIT[@]}" -C "$C/seed" checkout -q -B "$1" FETCH_HEAD
  printf 'change
' >> "$C/seed/PHASE"
  "${GIT[@]}" -C "$C/seed" add -A
  "${GIT[@]}" -C "$C/seed" commit -q -m "change on $1"
  "${GIT[@]}" -C "$C/seed" push -q "$C/origin.git" "HEAD:$1"
}

set_deployed() { mkdir -p "$H/deploy/.state"; echo "$1" > "$H/deploy/.state/current"; }

# run_update [ENV=VALUE...]: runs update.sh in the foreground with the fake docker. Sets RC.
run_update() {
  RC=0
  (cd "$H" && env PATH="$SHIMS:$PATH" SHIM_LOG="$C/calls.log" SHIM_PREV_TAG="$(cat deploy/.state/current 2>/dev/null)" "$@" \
    bash scripts/update.sh -f > "$C/out.log" 2>&1) || RC=$?
}

fail_check() { echo "    FAIL: $*"; CASE_OK=0; }
expect_rc() { [ "$RC" = "$1" ] || fail_check "exit $RC, expected $1"; }
expect_call() { grep -qE -- "$1" "$C/calls.log" || fail_check "no docker call matching: $1"; }
expect_no_call() { ! grep -qE -- "$1" "$C/calls.log" || fail_check "unexpected docker call matching: $1"; }
expect_out() { grep -qE -- "$1" "$C/out.log" || fail_check "output has no line matching: $1"; }
expect_state() { [ "$(cat "$H/deploy/.state/$1" 2>/dev/null)" = "$2" ] || fail_check "state $1 is '$(cat "$H/deploy/.state/$1" 2>/dev/null)', expected '$2'"; }
expect_no_lock() { [ ! -e "$H/.deploy/lock" ] || fail_check "the lock was left behind"; }

end_case() {
  # A call the fake docker has no rule for means the case tested the fake, not update.sh.
  if grep -q "fake docker: no rule" "$C/out.log" "$H"/.deploy/logs/*.log 2>/dev/null; then
    fail_check "update.sh made a docker call the fake has no rule for:"
    grep -h "fake docker: no rule" "$H"/.deploy/logs/*.log 2>/dev/null | sort -u | sed 's/^/        /'
  fi
  if [ "$CASE_OK" = 1 ]; then
    passed=$((passed + 1))
    echo "  PASS  $CASE_NAME"
  else
    failed=$((failed + 1))
    echo "  FAIL  $CASE_NAME (exit $RC)"
    sed 's/^/        | /' "$C/out.log" | tail -n 15
  fi
}

make_template
echo "verify-deploy: update.sh scenarios"

case_1() {
  new_case "first deploy succeeds and records the tag"
  tag=$(head12 "$H")
  run_update
  expect_rc 0
  expect_call "build --target test -t family-time:test-$tag"
  expect_call "build-arg GIT_COMMIT=$tag"
  expect_call "run --rm --network none family-time:test-$tag"
  expect_call "compose.test.yml up .*IMAGE_TAG=$tag"
  expect_call "compose.test.yml down"
  expect_call "run --rm migrate .*IMAGE_TAG=$tag"
  expect_call "up -d api worker .*IMAGE_TAG=$tag"
  # The household's own AdGuard is checked from the server, with the login on curl's standard input
  # and never on its command line; nothing else is started: not the bundled AdGuard, and no
  # optional service the owner has not switched on.
  expect_call "curl .*http://192.0.2.53:3000/control/status \[login-on-stdin\]"
  ! grep -q s3cret-adguard-pw "$C/calls.log" || fail_check "the AdGuard password reached a command line"
  expect_out "AdGuard at http://192.0.2.53:3000: reachable, login works, version supported"
  expect_no_call "up -d adguard"
  expect_no_call "compose -f deploy/compose.yml up -d \[IMAGE_TAG"
  expect_out "no running database yet"
  expect_state current "$tag"
  expect_state image.env "IMAGE_TAG=$tag"
  expect_no_lock
  end_case
}

case_2() {
  new_case "second deploy dumps the database, then moves current to previous"
  old=$(head12 "$H"); set_deployed "$old"
  push_commit
  run_update SHIM_PG_RUNNING=1
  new=$(head12 "$H")
  expect_rc 0
  [ "$new" != "$old" ] || fail_check "the pull did not move HEAD"
  ls "$H"/backups/pre-deploy/*-before-"$new".dump > /dev/null 2>&1 || fail_check "no pre-deploy dump"
  expect_state current "$new"
  expect_state previous "$old"
  end_case
}

case_24() {
  new_case "starts the optional services the owner switched on, and never an external AdGuard"
  echo 'COMPOSE_PROFILES=ledger-besu,ai-local' > "$H/deploy/.state/ledger.env"
  run_update
  expect_rc 0
  expect_call "compose -f deploy/compose.yml up -d besu ollama \[IMAGE_TAG"
  end_case
}

case_25() {
  new_case "the bundled AdGuard starts with the stack, and is not checked from outside"
  bundled_adguard "$H"
  echo 'COMPOSE_PROFILES=ledger-besu' > "$H/deploy/.state/ledger.env"
  run_update
  expect_rc 0
  expect_call "compose -f deploy/compose.yml up -d adguard besu \[IMAGE_TAG"
  expect_no_call "^curl "
  expect_out "the bundled one"
  end_case
}

case_26() {
  new_case "an external AdGuard that cannot be reached stops the deploy before anything is built"
  run_update SHIM_ADGUARD=down
  expect_rc 10
  expect_out "could not reach AdGuard at http://192.0.2.53:3000"
  expect_no_call "build"
  [ ! -e "$H/.deploy/lock" ] || fail_check "a lock was taken"
  end_case
}

case_27() {
  new_case "a refused AdGuard login says so, and how to replace the password"
  run_update SHIM_ADGUARD=auth
  expect_rc 10
  expect_out "refused the login for user familytime"
  expect_out "init.sh --adguard-new-password"
  expect_no_call "build"
  end_case
}

case_28() {
  new_case "an AdGuard older than the tested version is refused"
  run_update SHIM_ADGUARD_VERSION=v0.107.70
  expect_rc 10
  expect_out "older than v0.107.79"
  expect_no_call "build"
  end_case
}

case_29() {
  new_case "a newer AdGuard series is refused unless the owner opts in"
  run_update SHIM_ADGUARD_VERSION=v0.108.2
  expect_rc 10
  expect_out "newer series than the tested v0.107.79"
  expect_out "ADGUARD_ALLOW_UNTESTED=1"
  expect_no_call "build"
  external_adguard "$H" http://192.0.2.53:3000 0 1
  : > "$C/calls.log"
  run_update SHIM_ADGUARD_VERSION=v0.108.2
  expect_rc 0
  expect_out "note: AdGuard is v0.108.2, a newer series"
  end_case
}

case_30() {
  new_case "a later patch of the tested series deploys, with a note"
  run_update SHIM_ADGUARD_VERSION=v0.107.81
  expect_rc 0
  expect_out "note: AdGuard is v0.107.81, newer than the tested v0.107.79 in the same series"
  end_case
}

case_31() {
  new_case "an install from before the AdGuard choice is told to run init.sh again"
  rm -f "$H/deploy/.state/adguard.env"
  run_update
  expect_rc 10
  expect_out "which AdGuard to use"
  expect_out "Run ./scripts/init.sh again"
  expect_no_call "build"
  end_case
}

case_32() {
  new_case "an adguard.env that would run a command is refused, and runs nothing"
  printf 'ADGUARD_MODE=external\nADGUARD_URL=http://x$(touch %s/pwned)\nADGUARD_USER=familytime\n' "$C" > "$H/deploy/.state/adguard.env"
  run_update
  expect_rc 10
  expect_out "ADGUARD_URL is the address"
  [ ! -e "$C/pwned" ] || fail_check "adguard.env ran a command"
  expect_no_call "build"
  end_case
}

case_33() {
  new_case "a self-signed certificate is trusted only when the owner opts in"
  external_adguard "$H" https://adguard.home.example
  run_update SHIM_ADGUARD=tls
  expect_rc 10
  expect_out "certificate this server does not trust"
  expect_out "ADGUARD_CA=1"
  echo '-----BEGIN CERTIFICATE-----' > "$H/secrets/adguard_ca.pem"
  external_adguard "$H" https://adguard.home.example 1
  : > "$C/calls.log"
  run_update
  expect_rc 0
  expect_call "curl .*--cacert secrets/adguard_ca.pem .*https://adguard.home.example/control/status"
  end_case
}

case_3() {
  new_case "gate failure stops before anything live changes"
  run_update SHIM_FAIL=gate
  expect_rc 14
  expect_no_call "run --rm migrate"
  expect_no_call "up -d api worker"
  [ ! -e "$H/deploy/.state/current" ] || fail_check "state was written"
  expect_no_lock
  end_case
}

case_4() {
  new_case "real-Postgres test failure stops, and the test project is still removed"
  run_update SHIM_FAIL=pgtests
  expect_rc 15
  expect_call "compose.test.yml down -v"
  expect_no_call "run --rm migrate"
  end_case
}

case_5() {
  new_case "a dump that is too small stops before migrating, and is deleted"
  set_deployed "aaaaaaaaaaaa"
  run_update SHIM_PG_RUNNING=1 SHIM_FAIL=dump
  expect_rc 16
  expect_no_call "run --rm migrate"
  ! ls "$H"/backups/pre-deploy/*.dump > /dev/null 2>&1 || fail_check "the bad dump was kept"
  end_case
}

case_6() {
  new_case "migration failure leaves the running version alone"
  set_deployed "aaaaaaaaaaaa"
  run_update SHIM_FAIL=migrate
  expect_rc 17
  expect_no_call "up -d api worker"
  expect_state current "aaaaaaaaaaaa"
  end_case
}

case_7() {
  new_case "unhealthy new version rolls back to the previous tag"
  set_deployed "aaaaaaaaaaaa"
  tag=$(head12 "$H")
  run_update SHIM_FAIL=up-new
  expect_rc 21
  expect_call "up -d api worker .*IMAGE_TAG=aaaaaaaaaaaa"
  expect_call "image rm family-time:$tag family-time:test-$tag"
  expect_state current "aaaaaaaaaaaa"
  expect_out "ROLLED BACK"
  expect_no_lock
  end_case
}

case_8() {
  new_case "a failed rollback says the site is down"
  set_deployed "aaaaaaaaaaaa"
  run_update SHIM_FAIL=up-new,up-rollback
  expect_rc 22
  expect_out "ROLLBACK FAILED"
  end_case
}

case_9() {
  new_case "an unhealthy first deploy stops the stack"
  run_update SHIM_FAIL=up-new
  expect_rc 23
  expect_call "compose -f deploy/compose.yml stop api worker"
  [ ! -e "$H/deploy/.state/current" ] || fail_check "state was written"
  end_case
}

case_10() {
  new_case "a /version that names another commit rolls back"
  set_deployed "aaaaaaaaaaaa"
  run_update SHIM_FAIL=version
  expect_rc 21
  expect_out "does not report"
  end_case
}

case_11() {
  new_case "a second deploy is refused while one holds the lock, and the lock is left alone"
  mkdir -p "$H/.deploy/lock"; echo "pid 1" > "$H/.deploy/lock/owner"
  run_update
  expect_rc 11
  [ "$(cat "$H/.deploy/lock/owner" 2>/dev/null)" = "pid 1" ] || fail_check "the other deploy's lock was touched"
  expect_no_call "build"
  end_case
}

case_12() {
  new_case "local changes are refused before the lock is taken"
  echo dirty >> "$H/deploy/compose.yml"
  run_update
  expect_rc 10
  expect_out "local changes"
  [ ! -e "$H/.deploy/lock" ] || fail_check "a lock was taken"
  end_case
}

case_13() {
  new_case "a detached HEAD is refused"
  git -C "$H" checkout -q --detach
  run_update
  expect_rc 10
  expect_out "detached HEAD"
  end_case
}

case_14() {
  new_case "missing secrets are refused"
  rm -rf "$H/secrets"
  run_update
  expect_rc 10
  expect_out "init.sh"
  end_case
}

case_22() {
  new_case "an install from before AdGuard is told to run init.sh again"
  rm -f "$H/secrets/adguard_password"
  run_update
  expect_rc 10
  expect_out "Run ./scripts/init.sh again"
  expect_no_call "build"
  end_case
}

case_23() {
  new_case "an install from before alerts is told to run init.sh again"
  rm -f "$H/secrets/vapid_private.pem"
  run_update
  expect_rc 10
  expect_out "Run ./scripts/init.sh again"
  expect_no_call "build"
  end_case
}

case_15() {
  new_case "a missing proxy network is refused, with the command to create it"
  run_update SHIM_FAIL=nonet
  expect_rc 10
  expect_out "docker network create proxy_net"
  end_case
}

case_16() {
  new_case "TERM during the build stops, releases the lock and changes nothing"
  (cd "$H" && exec env PATH="$SHIMS:$PATH" SHIM_LOG="$C/calls.log" SHIM_SLOW=build bash scripts/update.sh -f > "$C/out.log" 2>&1) &
  pid=$!
  for _ in $(seq 1 600); do grep -q "build --build-arg" "$C/calls.log" 2>/dev/null && break; sleep 0.2; done
  # $pid is update.sh itself (the subshell execs it), so the signal reaches its trap.
  kill -TERM "$pid" 2>/dev/null
  RC=0; wait "$pid" || RC=$?
  expect_rc 143
  expect_no_call "run --rm migrate"
  expect_no_lock
  end_case
}

case_17() {
  new_case "a pull that changes update.sh runs the new script, once"
  push_commit "scripts/update.sh" "# a change to the deploy script"
  run_update
  expect_rc 0
  expect_out "running the new version"
  [ "$(grep -c '3/11 pull' "$C/out.log")" = 2 ] || fail_check "expected the pull step twice (old script, then new)"
  [ "$(grep -c 'skipping pull' "$C/out.log")" = 1 ] || fail_check "the new script pulled again"
  expect_no_lock
  end_case
}

case_18() {
  new_case "the drill builds a never-ready image under its own tag and rolls back"
  tag=$(head12 "$H"); set_deployed "$tag"
  run_update FT_DRILL=1 FT_NO_PULL=1 SHIM_FAIL=up-new
  expect_rc 21
  expect_call "build-arg FT_DRILL_UNREADY=1 -t family-time:$tag-drill"
  expect_state current "$tag"
  end_case
}

case_19() {
  new_case "a good deploy prunes every image except current and previous"
  set_deployed "aaaaaaaaaaaa"
  tag=$(head12 "$H")
  run_update SHIM_IMAGES="$tag aaaaaaaaaaaa bbbbbbbbbbbb test-$tag"
  expect_rc 0
  expect_call "image rm family-time:bbbbbbbbbbbb"
  expect_call "image rm family-time:test-$tag"
  expect_no_call "image rm family-time:aaaaaaaaaaaa"
  expect_no_call "image rm family-time:$tag "
  end_case
}

case_20() {
  new_case "a branch with no upstream is refused, with the command to fix it"
  git -C "$H" checkout -q -b local-only
  run_update
  expect_rc 10
  expect_out "does not track origin/local-only"
  expect_no_call "build"
  end_case
}

case_21() {
  new_case "a phase branch deploys from its own origin branch"
  "${GIT[@]}" -C "$C/seed" push -q "$C/origin.git" HEAD:phase-1
  git -C "$H" fetch -q origin
  git -C "$H" checkout -q -b phase-1 --track origin/phase-1
  push_commit_to phase-1
  run_update
  expect_rc 0
  [ "$(git -C "$H" rev-parse HEAD)" = "$(git -C "$C/origin.git" rev-parse phase-1)" ] || fail_check "the server is not at origin/phase-1"
  expect_state current "$(head12 "$H")"
  end_case
}

case_34() {
  new_case "moving to an external AdGuard removes the bundled one from before"
  run_update SHIM_OLD_ADGUARD=1
  expect_rc 0
  expect_call "rm -f oldadguard0"
  expect_out "removing the bundled AdGuard from before"
  expect_out "warning: http://192.0.2.53:3000 is plain http"
  end_case
}

ALL_CASES=$(seq 1 34)
# FT_CASES="6 7 8" runs only those cases. On the Windows laptop a full run can exhaust the process
# table, so run it there in batches; on Linux run all of them.
SELECTED=${FT_CASES:-$ALL_CASES}
expected=0
for n in $SELECTED; do
  expected=$((expected + 1))
  "case_$n"
done

total=$((passed + failed))
echo
# Floor: if the cases stop running (a typo above, an early exit), say so rather than pass on nothing.
if [ "$total" -ne "$expected" ] || [ "$total" -lt 1 ]; then
  echo "verify-deploy: $total cases ran, expected $expected. Refusing to pass."
  exit 2
fi
if [ "$failed" -gt 0 ]; then
  echo "verify-deploy: $failed of $total cases FAILED"
  exit 1
fi
echo "verify-deploy: all $total selected cases passed (cases: $(echo $SELECTED))"
