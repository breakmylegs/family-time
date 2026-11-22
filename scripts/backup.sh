#!/usr/bin/env bash
# The nightly backup (brief Part 15, ADR 0017). Run by family-time-backup.timer at 02:30, or by hand:
#
#   ./scripts/backup.sh
#
#   1 dumps Postgres, and checks the dump is complete and big enough before it counts
#   2 copies the bundled AdGuard's settings (an external AdGuard is backed up wherever it runs), and
#     the Besu chain with Besu stopped for the copy (ledger-besu only)
#   3 stores them in the data repository, and secrets/ in the keys repository (its own password)
#   4 checks both repositories, and only then forgets old snapshots (7 daily, 4 weekly, 6 monthly)
#   5 records the result, so the System page shows it and owners hear about a failure
#
# Exit codes: 0 done, 10 not set up, 11 a deploy or another backup is running, 30 dump failed,
# 31 copy failed, 32 snapshot failed, 33 check failed.
set -euo pipefail
# Everything this makes (the dump, the staging copy) is for root's eyes only.
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/deploy-lib.sh
. scripts/lib/deploy-lib.sh
# shellcheck source=lib/backup-lib.sh
. scripts/lib/backup-lib.sh

MIN_DUMP_BYTES=${FT_MIN_DUMP_BYTES:-16384}
KEEP=(--keep-daily 7 --keep-weekly 4 --keep-monthly 6)
# Tables a complete dump must hold data for.
REQUIRED=(households people ledger_entries audit_events __drizzle_migrations)
STAGE=backups/staging
LOCK=.deploy/backup.lock

say() { printf '%s backup: %s\n' "$(TZ=Europe/London date '+%Y-%m-%d %H:%M:%S')" "$*"; }

besu_stopped=0
locked=0
problem=""

cleanup() {
  local rc=$?
  if [ "$besu_stopped" = 1 ]; then
    compose start besu >/dev/null 2>&1 || say "Besu did not start again. Run: ./scripts/update.sh"
  fi
  rm -rf "$STAGE"
  [ "$locked" = 1 ] && rm -rf "$LOCK"
  if [ -n "$problem" ]; then
    # Recorded, so the System page shows it and the worker tells the owners.
    scripts/ft.sh backup-recorded --result failed --problem "$problem" >/dev/null 2>&1 || say "could not record the failure in the app"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# fail CODE MESSAGE: stops, and records why.
fail() {
  problem=$2
  say "FAILED: $2"
  exit "$1"
}

# 0 preflight. Nothing is recorded as failed here: backups are not set up yet.
command -v restic >/dev/null || { say "restic is not installed. Run: sudo apt install restic"; exit 10; }
[ -s deploy/.state/backup.env ] || { say "no deploy/.state/backup.env. Run ./scripts/init.sh, which makes it"; exit 10; }
load_backup_env || exit 10
[ -s secrets/restic_password ] && [ -s secrets/restic_keys_password ] || { say "no restic passwords in secrets/. Run ./scripts/init.sh again"; exit 10; }
IMAGE_TAG=$(state_read current)
export IMAGE_TAG
[ -n "$IMAGE_TAG" ] || { say "nothing is deployed yet. Run ./scripts/update.sh first"; exit 10; }

# 1 lock: never during a deploy, never two at once.
mkdir -p .deploy
if [ -e .deploy/lock ]; then say "a deploy is running. Try again when it has finished"; exit 11; fi
mkdir "$LOCK" 2>/dev/null || { say "another backup is running. If none is, remove $LOCK and run this again"; exit 11; }
locked=1

data() { restic -r "$BACKUP_REPO" --password-file secrets/restic_password "$@"; }
keys() { restic -r "$BACKUP_KEYS_REPO" --password-file secrets/restic_keys_password "$@"; }

# The first run makes the repositories.
data cat config >/dev/null 2>&1 || data init >/dev/null || fail 32 "could not make the data repository (see deploy/.state/backup.env)"
keys cat config >/dev/null 2>&1 || keys init >/dev/null || fail 32 "could not make the keys repository (see deploy/.state/backup.env)"

rm -rf "$STAGE"
mkdir -p "$STAGE"
chmod 700 "$STAGE"

# 2 the database
say "1/5 dumping the database"
[ -n "$(compose ps --status running -q postgres 2>/dev/null)" ] || fail 30 "the database is not running. Run ./scripts/update.sh"
compose exec -T postgres pg_dump -U family_time -d family_time --format=custom > "$STAGE/family_time.dump" || fail 30 "pg_dump failed"
size=$(wc -c < "$STAGE/family_time.dump")
[ "$size" -ge "$MIN_DUMP_BYTES" ] || fail 30 "the dump is only $size bytes, smaller than $MIN_DUMP_BYTES, so it is probably incomplete"
compose exec -T postgres pg_restore --list < "$STAGE/family_time.dump" > "$STAGE/contents.txt" || fail 30 "the dump could not be read back"
for t in "${REQUIRED[@]}"; do
  grep -Eq "TABLE DATA [a-z_]+ $t( |$)" "$STAGE/contents.txt" || fail 30 "the dump has no data for $t"
done
say "dumped $size bytes"

# 3 AdGuard's settings and the Besu chain, copied out of their volumes by the app image's own tar.
copy_volume() {
  local volume=$1 out=$2
  docker volume inspect "$volume" >/dev/null 2>&1 || return 0
  docker run --rm --network none --entrypoint tar -v "$volume:/src:ro" -v "$PWD/$STAGE:/out" "family-time:$IMAGE_TAG" -czf "/out/$out" -C /src . \
    || fail 31 "could not copy $volume"
}
ag_mode=external
load_adguard_env 2>/dev/null && ag_mode=$ADGUARD_MODE
if [ "$ag_mode" = bundled ]; then
  say "2/5 copying AdGuard's settings"
  copy_volume family-time_adguard-conf adguard-conf.tgz
else
  # Its settings are not Family time's to keep (ADR 0022). What Family time writes there (its ft-
  # clients and rules block) is rebuilt from the database within a minute of a restore.
  say "2/5 AdGuard runs elsewhere on the home network: it is backed up wherever it runs, not here"
fi
if grep -qsE '^COMPOSE_PROFILES=ledger-besu(,ai-local)?$' deploy/.state/ledger.env; then
  say "copying the Besu chain (Besu stops for a moment)"
  compose stop besu >/dev/null || fail 31 "could not stop Besu for the copy"
  besu_stopped=1
  copy_volume family-time_besu-data besu-data.tgz
  compose start besu >/dev/null || fail 31 "Besu did not start again after the copy"
  besu_stopped=0
fi

# 4 snapshots
say "3/5 storing the snapshot"
summary=$(data backup --json --tag nightly --host family-time "$STAGE" | grep '"message_type":"summary"' || true)
snapshot=$(printf '%s' "$summary" | sed -nE 's/.*"snapshot_id":"([0-9a-f]+)".*/\1/p')
[ -n "$snapshot" ] || fail 32 "restic did not make a snapshot of the data"
keys backup --tag keys --host family-time --exclude secrets/restic_keys_password secrets deploy/.state >/dev/null || fail 32 "restic did not make a snapshot of the keys"
say "snapshot ${snapshot:0:8}"

# 5 check, then rotate
say "4/5 checking the repositories"
data check >/dev/null || fail 33 "the data repository did not pass restic check"
keys check >/dev/null || fail 33 "the keys repository did not pass restic check"
say "5/5 forgetting old snapshots"
data forget --prune --tag nightly --host family-time "${KEEP[@]}" >/dev/null || fail 33 "could not forget old data snapshots"
keys forget --prune --tag keys --host family-time "${KEEP[@]}" >/dev/null || fail 33 "could not forget old key snapshots"

scripts/ft.sh backup-recorded --result ok --bytes "$size" --snapshot "${snapshot:0:12}" >/dev/null || say "the backup is done, but the app could not record it"
say "done"
