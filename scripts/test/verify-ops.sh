#!/usr/bin/env bash
# Scenario tests for scripts/backup.sh, restore.sh and verify.sh, with fake docker, restic and curl
# (scripts/test/ops-shims). Each case gets its own copy of the scripts and a fresh server folder,
# and checks the exit code AND what the script did: which calls it made, what it recorded, what it
# left behind. An exit code alone would count a syntax error as a pass.
#
#   bash scripts/test/verify-ops.sh                  every section
#   bash scripts/test/verify-ops.sh backup verify    some of them (backup, restore, verify)
set -uo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SHIMS="$REPO/scripts/test/ops-shims"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
chmod +x "$SHIMS"/* 2>/dev/null || true

passed=0
failed=0
cases=0
sections=" ${*:-backup restore verify} "
wants() { [[ "$sections" == *" $1 "* ]]; }

new_case() {
  cases=$((cases + 1))
  CASE_NAME=$1
  C="$WORK/case$cases"
  H="$C/host"
  mkdir -p "$H/scripts/lib" "$H/deploy/.state" "$H/secrets" "$H/packages/db/migrations/meta"
  cp "$REPO/scripts/backup.sh" "$REPO/scripts/restore.sh" "$REPO/scripts/verify.sh" "$REPO/scripts/ft.sh" "$H/scripts/"
  cp "$REPO/scripts/lib/deploy-lib.sh" "$REPO/scripts/lib/backup-lib.sh" "$H/scripts/lib/"
  cp "$REPO/deploy/compose.yml" "$REPO/deploy/compose.restore.yml" "$H/deploy/"
  cp "$REPO/packages/db/migrations/meta/_journal.json" "$H/packages/db/migrations/meta/"
  echo abc123def456 > "$H/deploy/.state/current"
  echo IMAGE_TAG=abc123def456 > "$H/deploy/.state/image.env"
  echo LAN_IP=192.0.2.10 > "$H/deploy/.state/network.env"
  printf 'BACKUP_REPO=%s\nBACKUP_KEYS_REPO=%s\n' "$C/repo-data" "$C/repo-keys" > "$H/deploy/.state/backup.env"
  echo pw > "$H/secrets/postgres_password"
  echo rp > "$H/secrets/restic_password"
  echo kp > "$H/secrets/restic_keys_password"
  : > "$C/calls.log"
  CASE_OK=1
}

# run SCRIPT [ENV=VALUE...] [-- ARGS...]: runs a script with the fakes first on PATH. Sets RC.
run() {
  local script=$1
  shift
  local envs=() args=()
  while [ $# -gt 0 ]; do
    if [ "$1" = -- ]; then shift; args=("$@"); break; fi
    envs+=("$1")
    shift
  done
  RC=0
  (cd "$H" && env PATH="$SHIMS:$PATH" SHIM_LOG="$C/calls.log" FT_MIN_DUMP_BYTES=1024 "${envs[@]}" bash "scripts/$script" "${args[@]}" < /dev/null > "$C/out.log" 2>&1) || RC=$?
}

fail_check() { echo "    FAIL: $*"; CASE_OK=0; }
expect_rc() { [ "$RC" = "$1" ] || fail_check "exit $RC, expected $1"; }
expect_call() { grep -qE -- "$1" "$C/calls.log" || fail_check "no call matching: $1"; }
expect_no_call() { ! grep -qE -- "$1" "$C/calls.log" || fail_check "unexpected call matching: $1"; }
expect_out() { grep -qE -- "$1" "$C/out.log" || fail_check "output has no line matching: $1"; }
expect_recorded() { grep -qE -- "$1" "$C/calls.log.recorded" 2>/dev/null || fail_check "recorded nothing matching: $1"; }
expect_nothing_recorded() { [ ! -s "$C/calls.log.recorded" ] || fail_check "recorded: $(cat "$C/calls.log.recorded")"; }
# The call matching $1 comes before the call matching $2.
expect_order() {
  local a b
  a=$(grep -nE -- "$1" "$C/calls.log" | head -n 1 | cut -d: -f1)
  b=$(grep -nE -- "$2" "$C/calls.log" | head -n 1 | cut -d: -f1)
  [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ] || fail_check "expected '$1' before '$2'"
}

end_case() {
  grep -q "fake .*: no rule" "$C/out.log" && fail_check "a call the fakes have no rule for: $(grep -h 'no rule' "$C/out.log" | head -n 1)"
  if [ "$CASE_OK" = 1 ]; then
    passed=$((passed + 1))
    echo "  PASS  $CASE_NAME"
  else
    failed=$((failed + 1))
    echo "  FAIL  $CASE_NAME (exit $RC)"
    sed 's/^/        | /' "$C/out.log" | tail -n 15
  fi
}

if wants backup; then
echo "verify-ops: backup.sh"

new_case "refuses without the backup settings, and records nothing"
rm "$H/deploy/.state/backup.env"
run backup.sh
expect_rc 10
expect_out "init.sh"
expect_nothing_recorded
end_case

new_case "makes the repositories, dumps, checks, stores, checks again, then rotates and records"
run backup.sh
expect_rc 0
expect_call "restic -r $C/repo-data .* init"
expect_call "restic -r $C/repo-keys .* init"
expect_call "pg_dump -U family_time -d family_time --format=custom"
expect_call "pg_restore --list"
expect_call "backup --tag keys --host family-time --exclude secrets/restic_keys_password secrets deploy/.state"
expect_order "restic -r $C/repo-data .* check" "restic -r $C/repo-data .* forget"
expect_recorded "--result ok --bytes 20000 --snapshot abcdef123456"
[ ! -e "$H/backups/staging" ] || fail_check "the staging folder was left behind"
[ ! -e "$H/.deploy/backup.lock" ] || fail_check "the lock was left behind"
end_case

new_case "refuses a dump below the size floor, and records why"
run backup.sh SHIM_DUMP_BYTES=100
expect_rc 30
expect_recorded "--result failed --problem the dump is only 100 bytes, smaller than 1024, so it is probably incomplete"
expect_no_call "backup --json"
end_case

new_case "refuses a dump with a table missing"
run backup.sh SHIM_FAIL=list
expect_rc 30
expect_recorded "no data for ledger_entries"
end_case

new_case "never forgets old snapshots when the check fails"
run backup.sh SHIM_FAIL=check
expect_rc 33
expect_no_call " forget "
expect_recorded "did not pass restic check"
end_case

new_case "waits for a running deploy"
mkdir -p "$H/.deploy/lock"
run backup.sh
expect_rc 11
expect_no_call "pg_dump"
expect_nothing_recorded
end_case

new_case "refuses a backup.env that would run a command"
printf 'BACKUP_REPO=/x;touch${IFS}%s/pwned\nBACKUP_KEYS_REPO=/y\n' "$C" > "$H/deploy/.state/backup.env"
run backup.sh
expect_rc 10
[ ! -e "$C/pwned" ] || fail_check "backup.env ran a command"
expect_no_call "pg_dump"
end_case

new_case "stops Besu for its copy, and starts it again even when the copy fails"
echo COMPOSE_PROFILES=ledger-besu > "$H/deploy/.state/ledger.env"
run backup.sh SHIM_VOLUMES="family-time_besu-data" SHIM_FAIL=copy
expect_rc 31
expect_call "stop besu"
expect_call "start besu"
end_case

new_case "copies AdGuard and the Besu chain when they exist"
echo COMPOSE_PROFILES=ledger-besu > "$H/deploy/.state/ledger.env"
run backup.sh SHIM_VOLUMES="family-time_adguard-conf family-time_besu-data"
expect_rc 0
expect_call "family-time_adguard-conf:/src:ro"
expect_call "family-time_besu-data:/src:ro"
expect_order "stop besu" "start besu"
end_case

fi

if wants restore; then
echo "verify-ops: restore.sh"

new_case "the drill restores into a scratch database, checks it, and removes it"
run restore.sh SHIM_MIGRATIONS=12
expect_rc 0
expect_call "compose -p family-time-restore -f deploy/compose.restore.yml up -d --wait postgres"
expect_call "pg_restore -U family_time -d family_time --no-owner --exit-on-error /restore/family_time.dump"
expect_call "compose -p family-time-restore -f deploy/compose.restore.yml down -v"
expect_no_call "compose -f deploy/compose.yml"
expect_out "drill passed"
expect_out "AdGuard's settings: readable"
end_case

new_case "the drill fails when a table is missing, and still removes the scratch database"
run restore.sh SHIM_MISSING=ledger_entries
expect_rc 41
expect_out "MISSING  ledger_entries"
expect_call "compose -p family-time-restore -f deploy/compose.restore.yml down -v"
end_case

new_case "the drill fails when the dump has more migrations than this version knows"
run restore.sh SHIM_MIGRATIONS=999
expect_rc 41
end_case

new_case "puts the keys back on a new server, keeping anything already there"
rm "$H/secrets/restic_password" "$H/secrets/restic_keys_password" "$H/deploy/.state/backup.env"
RC=0
(cd "$H" && printf 'the-keys-password\n' | env PATH="$SHIMS:$PATH" SHIM_LOG="$C/calls.log" bash scripts/restore.sh --keys --repo "$C/repo-keys" > "$C/out.log" 2>&1) || RC=$?
expect_rc 0
[ "$(cat "$H/secrets/restic_password")" = restored-restic ] || fail_check "secrets/restic_password was not restored"
[ "$(cat "$H/secrets/postgres_password")" = pw ] || fail_check "an existing secret was replaced"
[ "$(cat "$H/secrets/restic_keys_password")" = the-keys-password ] || fail_check "the keys password was not kept"
[ -s "$H/deploy/.state/backup.env" ] || fail_check "deploy/.state/backup.env was not restored"
end_case

new_case "--live refuses without a terminal to confirm in"
run restore.sh -- --live
expect_rc 42
expect_no_call "compose -f deploy/compose.yml stop"
expect_no_call "--clean"
end_case

fi

if wants verify; then
echo "verify-ops: verify.sh"

probe_closed() { cat > "$C/probe" <<'EOF'
#!/usr/bin/env bash
[ "$2" = 53 ] || [ "$2" = "${OPEN_PORT:-none}" ]
EOF
chmod +x "$C/probe"; }

new_case "all green"
probe_closed
run verify.sh FT_PORT_PROBE="$C/probe" -- --url https://family.example.com
expect_rc 0
expect_out "all green"
expect_out "Postgres is not reachable on port 5432"
expect_out "signed-out requests are refused"
end_case

new_case "a database reachable from outside Docker is a finding"
probe_closed
run verify.sh FT_PORT_PROBE="$C/probe" OPEN_PORT=5432
expect_rc 1
expect_out "FAIL  Postgres answers on port 5432"
end_case

new_case "a readiness check failing is a finding, named"
probe_closed
run verify.sh FT_PORT_PROBE="$C/probe" SHIM_FAIL=ready
expect_rc 1
expect_out "worker \(no heartbeat yet\)"
end_case

new_case "a different commit from the one deployed is a finding"
probe_closed
run verify.sh FT_PORT_PROBE="$C/probe" SHIM_COMMIT=000000000000
expect_rc 1
expect_out "commit '000000000000'"
end_case

new_case "an api that does not answer is unreachable, never a pass"
probe_closed
run verify.sh FT_PORT_PROBE="$C/probe" SHIM_FAIL=api
expect_rc 2
end_case
fi

echo
echo "verify-ops: $passed of $cases passed"
[ "$failed" = 0 ]
