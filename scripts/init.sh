#!/usr/bin/env bash
# First-time setup on the server. Creates every secret the stack needs under secrets/, mode 0600,
# owned by root. Safe to run again: it never replaces a secret that already exists, because the
# Postgres password, for one, is fixed into the database the first time Postgres starts.
#
# Later phases add more here (ledger keys, the owner invite).
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
make_secret adguard_password 24

# The Web Push (VAPID) key: a P-256 private key in PEM. The api gives browsers its public half.
if [ -s secrets/vapid_private.pem ]; then
  echo "  kept     secrets/vapid_private.pem"
else
  tmp=$(mktemp "secrets/.vapid.XXXXXX")
  openssl ecparam -name prime256v1 -genkey -noout -out "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" secrets/vapid_private.pem
  echo "  created  secrets/vapid_private.pem"
fi

# The server's LAN address, where AdGuard publishes DNS port 53. Found from the default route, and
# never 0.0.0.0, which would clash with the server's own resolver. Kept if already set; edit
# deploy/.state/network.env by hand if the server's address ever changes.
echo
echo "init.sh: network"
if [ -s deploy/.state/network.env ]; then
  echo "  kept     deploy/.state/network.env ($(cat deploy/.state/network.env))"
else
  lan_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' | head -n 1)
  if [ -z "$lan_ip" ]; then
    echo "init.sh: could not find this server's LAN address. Write it yourself, for example: echo LAN_IP=192.168.1.10 > deploy/.state/network.env" >&2
    exit 1
  fi
  printf 'LAN_IP=%s\n' "$lan_ip" > deploy/.state/network.env
  echo "  created  deploy/.state/network.env (LAN_IP=$lan_ip)"
fi

echo
echo "init.sh: done. Next: ./scripts/update.sh"
