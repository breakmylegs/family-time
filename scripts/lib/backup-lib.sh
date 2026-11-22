# Helpers for scripts/backup.sh and scripts/restore.sh. Sourced, never run.
# shellcheck shell=bash

# The project name for restore drills, given on every call so COMPOSE_PROJECT_NAME can never point
# a drill at the live stack.
readonly DRILL_PROJECT=family-time-restore

# Reads deploy/.state/backup.env without running it: only BACKUP_REPO and BACKUP_KEYS_REPO, each a
# path or restic URL of safe characters. Anything else is refused, so the file can never run a
# command, even as root at 02:30.
load_backup_env() {
  local file=${1:-deploy/.state/backup.env} key value
  BACKUP_REPO=""
  BACKUP_KEYS_REPO=""
  [ -s "$file" ] || return 1
  while IFS='=' read -r key value || [ -n "$key" ]; do
    case $key in
      '' | '#'*) continue ;;
      BACKUP_REPO | BACKUP_KEYS_REPO) ;;
      *) echo "$file may only hold BACKUP_REPO= and BACKUP_KEYS_REPO= (docs/setup/backup.md)" >&2; return 2 ;;
    esac
    if ! [[ "$value" =~ ^[A-Za-z0-9_./:@%+=-]+$ ]]; then
      echo "$file: $key has characters that are not allowed. Use a plain path or a restic URL" >&2
      return 2
    fi
    printf -v "$key" '%s' "$value"
  done < "$file"
  [ -n "$BACKUP_REPO" ] && [ -n "$BACKUP_KEYS_REPO" ] || { echo "$file needs BACKUP_REPO and BACKUP_KEYS_REPO" >&2; return 2; }
}

# A restored state file is only kept if it is one of the known shapes.
state_file_ok() {
  local file=$1
  case $(basename "$file") in
    backup.env) load_backup_env "$file" 2>/dev/null ;;
    network.env) grep -Eq '^LAN_IP=[0-9]{1,3}(\.[0-9]{1,3}){3}$' "$file" && ! grep -Evq '^(LAN_IP=[0-9.]+|#.*|)$' "$file" ;;
    ledger.env) ! grep -Evq '^(#.*|LEDGER_ADAPTER=(postgres|besu)|COMPOSE_PROFILES=(ledger-besu|ai-local|ledger-besu,ai-local)|)$' "$file" ;;
    adguard.env) load_adguard_env "$file" 2>/dev/null ;;
    image.env) ! grep -Evq '^(#.*|IMAGE_TAG=[0-9a-f]{7,40}(-drill)?|)$' "$file" ;;
    ledger-admin.env) ! grep -Evq '^(#.*|LEDGER_ADMIN_USED=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z|)$' "$file" ;;
    *) return 1 ;;
  esac
}
