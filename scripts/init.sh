#!/usr/bin/env bash
# First-time setup on the server. Creates every secret the stack needs under secrets/, mode 0600,
# owned by root. Safe to run again: it never replaces a secret that already exists, because the
# Postgres password, for one, is fixed into the database the first time Postgres starts.
#
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
# The Besu ledger's keys (ADR 0014): 32 random bytes is a secp256k1 private key. The signer writes
# the ledger; the admin key is the cold key, used once by ledger-deploy and then kept offline; the
# node key is the validator's. Made for every install, used only with the ledger-besu profile.
make_secret ledger_signer_key 32
# Once ./scripts/ft.sh ledger-deploy has used it, the admin key lives offline: never made again here.
if [ -e deploy/.state/ledger-admin.env ]; then
  if [ -e secrets/ledger_admin_key ]; then
    echo "  kept     secrets/ledger_admin_key (the contract is deployed: move it offline and delete it here)"
  else
    echo "  skipped  secrets/ledger_admin_key (the contract is deployed; the admin key is kept offline)"
  fi
else
  make_secret ledger_admin_key 32
fi
make_secret besu_node_key 32
# Owner sign-in through Authentik's client secret, which Authentik makes: left empty (off) here, and
# filled in by the owner (docs/setup/authentik.md). Never replaced once it holds something.
if [ -e secrets/oidc_client_secret ]; then
  echo "  kept     secrets/oidc_client_secret"
else
  : > secrets/oidc_client_secret
  chmod 600 secrets/oidc_client_secret
  echo "  created  secrets/oidc_client_secret (empty: sign-in through Authentik is off)"
fi

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
# Its public half, for the api, which never needs the private key (ADR 0017): the uncompressed
# point, base64url, the last 65 bytes of the public key's DER.
if [ -s secrets/vapid_public.txt ]; then
  echo "  kept     secrets/vapid_public.txt"
else
  openssl ec -in secrets/vapid_private.pem -pubout -outform DER 2>/dev/null | tail -c 65 | base64 -w0 | tr '+/' '-_' | tr -d '=' > secrets/vapid_public.txt
  chmod 600 secrets/vapid_public.txt
  echo "  created  secrets/vapid_public.txt"
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

# Backups (ADR 0017): two restic repositories, each with its own password, so the family's data
# and the keys that protect it are never opened by one password. The keys repository's password
# belongs offline too: write it down. Defaults to local folders; any restic URL works.
echo
echo "init.sh: backups"
make_secret restic_password 32
make_secret restic_keys_password 32
if [ -s deploy/.state/backup.env ]; then
  echo "  kept     deploy/.state/backup.env"
else
  printf 'BACKUP_REPO=/var/backups/family-time/data\nBACKUP_KEYS_REPO=/var/backups/family-time/keys\n' > deploy/.state/backup.env
  echo "  created  deploy/.state/backup.env (local folders; see docs/setup/backup.md to use another disk)"
fi
command -v restic >/dev/null || echo "  note     restic is not installed yet: sudo apt install restic"

echo
echo "init.sh: done. Next: ./scripts/update.sh"
