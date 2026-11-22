#!/usr/bin/env bash
# Restores a backup (brief Part 15, ADR 0017). A backup never restored is not a backup.
#
#   ./scripts/restore.sh                   the drill: the latest snapshot, into a scratch database, checked
#   ./scripts/restore.sh --snapshot ID     the drill for an older snapshot
#   ./scripts/restore.sh --list            the snapshots there are
#   ./scripts/restore.sh --keys --repo R   a new server: put secrets/ and deploy/.state back first
#   ./scripts/restore.sh --live            disaster recovery: put the data back into the live stack
#
# The drill never touches the live stack: it uses its own Compose project (deploy/compose.restore.yml)
# with an in-memory Postgres and no network, and removes it at the end.
#
# Exit codes: 0 done, 10 not set up, 40 restore failed, 41 a check failed, 42 refused.
set -euo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/deploy-lib.sh
. scripts/lib/deploy-lib.sh
# shellcheck source=lib/backup-lib.sh
. scripts/lib/backup-lib.sh

MIN_DUMP_BYTES=${FT_MIN_DUMP_BYTES:-16384}
REQUIRED=(households people ledger_entries audit_events)
say() { printf '%s restore: %s\n' "$(TZ=Europe/London date '+%Y-%m-%d %H:%M:%S')" "$*"; }

mode=drill
snapshot=latest
keys_repo=""
while [ $# -gt 0 ]; do
  case $1 in
    --snapshot) snapshot=${2:?--snapshot needs an id}; shift 2 ;;
    --list) mode=list; shift ;;
    --keys) mode=keys; shift ;;
    --repo) keys_repo=${2:?--repo needs the keys repository}; shift 2 ;;
    --live) mode=live; shift ;;
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
    *) say "unknown option $1. See ./scripts/restore.sh --help"; exit 42 ;;
  esac
done
[[ "$snapshot" =~ ^(latest|[0-9a-f]{8,64})$ ]] || { say "a snapshot id is 8 or more hex characters. See ./scripts/restore.sh --list"; exit 42; }

command -v restic >/dev/null || { say "restic is not installed. Run: sudo apt install restic"; exit 10; }

WORK=$(mktemp -d)
drill_up=0
live_stopped=0
locked=0
# The scratch project, always by its own name, so COMPOSE_PROJECT_NAME can never point it at live.
drill() { docker compose -p "$DRILL_PROJECT" -f deploy/compose.restore.yml "$@"; }
cleanup() {
  local rc=$?
  [ "$drill_up" = 1 ] && RESTORE_DIR=$WORK drill down -v --remove-orphans >/dev/null 2>&1
  # A live restore that stops part way never leaves the home without Control or DNS.
  if [ "$live_stopped" = 1 ]; then
    compose up -d >/dev/null 2>&1 || say "could not start the stack again. Run ./scripts/update.sh now"
  fi
  [ "$locked" = 1 ] && rm -rf .deploy/backup.lock
  rm -rf "$WORK"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---- A new server: the keys first, from the keys repository and its password (kept offline).
if [ "$mode" = keys ]; then
  [ -n "$keys_repo" ] || { say "give the keys repository: ./scripts/restore.sh --keys --repo /var/backups/family-time/keys"; exit 42; }
  if [ -t 0 ]; then
    read -rsp "The keys repository's password: " RESTIC_PASSWORD
    echo
  else
    read -r RESTIC_PASSWORD
  fi
  export RESTIC_PASSWORD
  restic -r "$keys_repo" restore latest --tag keys --target "$WORK" >/dev/null || { say "could not restore from $keys_repo"; exit 40; }
  src=$(find "$WORK" -type d -name secrets -print -quit)
  [ -n "$src" ] || { say "the keys snapshot has no secrets/"; exit 40; }
  umask 077
  mkdir -p secrets deploy/.state
  for f in "$src"/* "$(dirname "$src")"/deploy/.state/*.env; do
    [ -f "$f" ] || continue
    case $f in */secrets/*) dest=secrets/$(basename "$f") ;; *) dest=deploy/.state/$(basename "$f") ;; esac
    if [ -s "$dest" ]; then say "kept     $dest (already here)"; continue; fi
    if [[ "$dest" == deploy/.state/* ]] && ! state_file_ok "$f"; then say "skipped  $dest (not in the expected form, so it is not trusted)"; continue; fi
    cp "$f" "$dest"
    chmod 600 "$dest"
    say "restored $dest"
  done
  printf '%s\n' "$RESTIC_PASSWORD" > secrets/restic_keys_password
  chmod 600 secrets/restic_keys_password
  say "done. Next: ./scripts/update.sh, then ./scripts/restore.sh --live"
  exit 0
fi

[ -s deploy/.state/backup.env ] && [ -s secrets/restic_password ] || { say "backups are not set up here (deploy/.state/backup.env, secrets/restic_password). See docs/setup/backup.md"; exit 10; }
load_backup_env || exit 10
data() { restic -r "$BACKUP_REPO" --password-file secrets/restic_password "$@"; }

if [ "$mode" = list ]; then
  data snapshots --tag nightly --host family-time
  exit 0
fi

# ---- Restore the snapshot's files and check the dump, for the drill and for --live alike.
say "restoring snapshot $snapshot"
if [ "$snapshot" = latest ]; then
  data restore latest --tag nightly --host family-time --target "$WORK/files" >/dev/null || { say "restic could not restore the latest snapshot"; exit 40; }
else
  data restore "$snapshot" --target "$WORK/files" >/dev/null || { say "restic could not restore snapshot $snapshot. See ./scripts/restore.sh --list"; exit 40; }
fi
dump=$(find "$WORK/files" -type f -name family_time.dump -print -quit)
[ -n "$dump" ] || { say "the snapshot has no database dump"; exit 40; }
size=$(wc -c < "$dump")
[ "$size" -ge "$MIN_DUMP_BYTES" ] || { say "the dump is only $size bytes, so it is probably incomplete. Try an older one from --list"; exit 41; }
files=$(dirname "$dump")
say "found the dump ($size bytes)"

shipped=$(grep -c '"tag":' packages/db/migrations/meta/_journal.json)

# check_db PSQL...: the tables, their rows and the migrations, in whichever database PSQL reaches.
check_db() {
  local ok=1 n t applied
  for t in "${REQUIRED[@]}"; do
    n=$("$@" -At -c "select count(*) from $t" 2>/dev/null | tr -d '[:space:]') || n=""
    if [ -z "$n" ]; then say "  MISSING  $t"; ok=0; else say "  $(printf '%-16s' "$t") $n rows"; fi
  done
  n=$("$@" -At -c "select count(*) from households" 2>/dev/null | tr -d '[:space:]') || n=0
  [ "${n:-0}" -ge 1 ] || { say "  no household in the restored database"; ok=0; }
  applied=$("$@" -At -c "select count(*) from drizzle.__drizzle_migrations" 2>/dev/null | tr -d '[:space:]') || applied=0
  if [ "${applied:-0}" -lt 1 ] || [ "${applied:-0}" -gt "$shipped" ]; then
    say "  migrations: $applied applied, this version ships $shipped"
    ok=0
  else
    local note=""
    [ "$applied" -lt "$shipped" ] && note=", update.sh applies the rest"
    say "  migrations: $applied of $shipped$note"
  fi
  [ "$ok" = 1 ]
}

# The drill. --live runs it first too, so a backup that does not restore cleanly never reaches live.
say "starting a scratch database (nothing live is touched)"
export RESTORE_DIR=$files
drill_up=1
drill up -d --wait postgres >/dev/null || { say "the scratch database did not start"; exit 40; }
scratch() { drill exec -T postgres "$@"; }
{
  scratch pg_restore -U family_time -d family_time --no-owner --exit-on-error /restore/family_time.dump || { say "pg_restore failed"; exit 40; }
  say "checking"
  check_db scratch psql -U family_time -d family_time || { say "FAILED: the restored database is not complete. Try --snapshot with an older id, and paste this output into the build chat"; exit 41; }
  if [ -f "$files/adguard-conf.tgz" ]; then
    tar -tzf "$files/adguard-conf.tgz" >/dev/null || { say "FAILED: AdGuard's settings cannot be read"; exit 41; }
    say "  AdGuard's settings: readable"
  else
    say "  AdGuard's settings: not in this backup (an AdGuard elsewhere on the home network is backed up wherever it runs)"
  fi
  [ -f "$files/besu-data.tgz" ] && { tar -tzf "$files/besu-data.tgz" >/dev/null || { say "FAILED: the Besu copy cannot be read"; exit 41; }; say "  Besu chain: readable"; }
  if [ -s secrets/restic_keys_password ] && [ -n "${BACKUP_KEYS_REPO:-}" ]; then
    restic -r "$BACKUP_KEYS_REPO" --password-file secrets/restic_keys_password snapshots --tag keys --latest 1 >/dev/null || { say "FAILED: the keys repository has no snapshot"; exit 41; }
    say "  keys repository: has a snapshot"
  fi
  say "drill passed: the backup restores and checks out"
}
RESTORE_DIR=$WORK drill down -v --remove-orphans >/dev/null 2>&1
drill_up=0
[ "$mode" = drill ] && exit 0

# ---- --live: disaster recovery into the real stack.
IMAGE_TAG=$(state_read current)
export IMAGE_TAG
[ -n "$IMAGE_TAG" ] || { say "deploy first, so there is a stack to restore into: ./scripts/update.sh"; exit 10; }
[ -t 0 ] || { say "--live asks you to confirm, so run it in a terminal"; exit 42; }
echo
echo "This replaces everything in the live database with the backup ($snapshot, $size bytes)."
echo "Changes made since that backup are lost. A copy of the database as it is now is kept first."
read -rp 'Type "restore live" to carry on: ' answer
[ "$answer" = "restore live" ] || { say "not restored"; exit 42; }
mkdir -p .deploy
[ -e .deploy/lock ] && { say "a deploy is running. Try again when it has finished"; exit 42; }
mkdir .deploy/backup.lock 2>/dev/null || { say "a backup is running. Try again when it has finished"; exit 42; }
locked=1

mkdir -p backups/pre-restore
before="backups/pre-restore/$(date -u +%Y%m%dT%H%M%SZ).dump"
compose exec -T postgres pg_dump -U family_time -d family_time --format=custom > "$before" || { say "could not keep a copy of the live database first, so nothing was restored"; exit 40; }
say "kept the live database as it was in $before"
ls -1t backups/pre-restore/*.dump 2>/dev/null | tail -n +6 | xargs -r rm -f
live_stopped=1
compose stop api worker >/dev/null
compose exec -T postgres pg_restore -U family_time -d family_time --clean --if-exists --no-owner --exit-on-error --single-transaction < "$dump" || { say "pg_restore failed and changed nothing: it runs as one transaction. The stack starts again now. A copy of the live database is in $before. Paste this output into the build chat"; exit 40; }
restore_volume() {
  local volume=$1 file=$2 service=$3
  [ -f "$files/$file" ] || return 0
  compose stop "$service" >/dev/null 2>&1 || true
  docker run --rm --network none --entrypoint sh -v "$volume:/dest" -v "$files:/in:ro" "family-time:$IMAGE_TAG" -c "rm -rf /dest/* && tar -xzf /in/$file -C /dest" || { say "could not restore $volume"; exit 40; }
  say "restored $volume"
}
ag_mode=external
load_adguard_env 2>/dev/null && ag_mode=$ADGUARD_MODE
if [ "$ag_mode" = bundled ]; then
  restore_volume family-time_adguard-conf adguard-conf.tgz adguard
else
  say "AdGuard runs elsewhere on the home network: restore it wherever it is backed up. Family time writes its own clients and rules block back within a minute of starting"
fi
restore_volume family-time_besu-data besu-data.tgz besu
compose up -d >/dev/null
live_stopped=0
say "checking"
check_db compose exec -T postgres psql -U family_time -d family_time || { say "FAILED: the live database is not complete after the restore. The copy from before is in $before"; exit 41; }
say "done. Next: ./scripts/verify.sh"
