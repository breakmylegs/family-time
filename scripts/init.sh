#!/usr/bin/env bash
# First-time setup on the server. Creates every secret the stack needs under secrets/, mode 0600,
# owned by root. Safe to run again: it never replaces a secret that already exists, because the
# Postgres password, for one, is fixed into the database the first time Postgres starts.
#
# Later phases add more here (VAPID keys, ledger keys, the owner invite).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ "$(id -u)" != "0" ]; then
  echo "init.sh: run this as root (sudo su -), so the secrets are owned by root." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "init.sh: openssl is not installed." >&2; exit 1; }

umask 077
mkdir -p secrets deploy/.state backups
chmod 700 secrets

# make_secret NAME BYTES: random hex, written to a temp file then renamed, so a half-written
# secret can never be left behind.
make_secret() {
  local name=$1 bytes=$2 file="secrets/$1" tmp
  if [ -s "$file" ]; then
    echo "  kept     $file"
    return
  fi
  tmp=$(mktemp "secrets/.$name.XXXXXX")
  openssl rand -hex "$bytes" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
  echo "  created  $file"
}

echo "init.sh: secrets"
make_secret postgres_password 32
make_secret session_key 48
make_secret master_key 32

echo
echo "init.sh: done. Next: ./scripts/update.sh"
