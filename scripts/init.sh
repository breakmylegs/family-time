#!/usr/bin/env bash
# First-time setup on the server. Creates every secret the stack needs under secrets/, mode 0600,
# owned by root. Safe to run again: it never replaces a secret that already exists, because the
# Postgres password, for one, is fixed into the database the first time Postgres starts.
#
# Which AdGuard Family time uses (ADR 0022, docs/setup/network.md). Asked in a terminal when not
# given; kept as it is on a later run unless given again.
#   --adguard external|bundled   your own AdGuard Home on the home network (the default), or one
#                                Family time runs itself
#   --adguard-url URL            external: the address of its web page, http://192.168.1.2:3000
#   --adguard-user NAME          external: the AdGuard user Family time signs in as
#   --adguard-ca FILE            external, https: trust this self-signed certificate
#   --adguard-new-password       external: ask for the AdGuard password again
#   --adguard-password-stdin     external: read the password from standard input, not a prompt
# The password is never taken on the command line, where it would land in the shell's history.
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=lib/deploy-lib.sh
. scripts/lib/deploy-lib.sh

opt_mode="" opt_url="" opt_user="" opt_ca="" opt_new_pw=0 opt_pw_stdin=0
while [ $# -gt 0 ]; do
  case $1 in
    --adguard) opt_mode=${2:?--adguard is external or bundled}; shift 2 ;;
    --adguard-url) opt_url=${2:?--adguard-url needs the address of the AdGuard web page}; shift 2 ;;
    --adguard-user) opt_user=${2:?--adguard-user needs the AdGuard user}; shift 2 ;;
    --adguard-ca) opt_ca=${2:?--adguard-ca needs the certificate file}; shift 2 ;;
    --adguard-new-password) opt_new_pw=1; shift ;;
    --adguard-password-stdin) opt_pw_stdin=1; shift ;;
    -h | --help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "init.sh: unknown option $1 (try --help). The AdGuard password is never an option: it is asked for." >&2; exit 2 ;;
  esac
done
case $opt_mode in '' | external | bundled) ;; *) echo "init.sh: --adguard is external or bundled" >&2; exit 2 ;; esac

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

# The server's LAN address: where the kiosk listens, and where the bundled AdGuard, if chosen,
# publishes DNS port 53. Found from the default route, and never 0.0.0.0, which would clash with the
# server's own resolver. Kept if already set; edit deploy/.state/network.env by hand if the server's
# address ever changes.
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

# AdGuard (ADR 0022): by default the household's own AdGuard Home, already running elsewhere on the
# home network; or the bundled one, which Family time runs and sets up itself. Everything already
# chosen is kept unless given again.
echo
echo "init.sh: AdGuard"
ask() { # ask PROMPT DEFAULT: a line from the terminal, or DEFAULT when there is none.
  local answer=""
  if [ -r /dev/tty ] && [ -t 0 ]; then read -rp "$1 " answer < /dev/tty || true; fi
  printf '%s' "${answer:-$2}"
}
had_mode="" had_url="" had_user="" had_ca=0 had_untested=0
had_rc=0
load_adguard_env 2>/tmp/ft-adguard-env.$$ || had_rc=$?
if [ "$had_rc" = 0 ]; then
  had_mode=$ADGUARD_MODE had_url=$ADGUARD_URL had_user=$ADGUARD_USER had_ca=$ADGUARD_CA had_untested=$ADGUARD_ALLOW_UNTESTED
elif [ "$had_rc" != 1 ]; then
  # Never guess past a file that is there but wrong: say why, and let the owner fix or remove it.
  echo "init.sh: $(cat /tmp/ft-adguard-env.$$)" >&2
  echo "init.sh: fix deploy/.state/adguard.env, or remove it and run this again to choose afresh." >&2
  rm -f /tmp/ft-adguard-env.$$
  exit 2
fi
rm -f /tmp/ft-adguard-env.$$
mode=${opt_mode:-$had_mode}
if [ -z "$mode" ]; then
  # An install from before this choice ran the bundled AdGuard: keep it that way.
  if command -v docker >/dev/null && docker volume inspect family-time_adguard-conf >/dev/null 2>&1; then
    mode=bundled
    echo "  found    the bundled AdGuard's settings from before, so it stays bundled (--adguard external to change)"
  else
    mode=$(ask "Use your own AdGuard Home on the home network (external), or one Family time runs (bundled)? [external]" external)
  fi
fi
case $mode in external | bundled) ;; *) echo "init.sh: the answer is external or bundled" >&2; exit 2 ;; esac

ca=$had_ca
[ -e secrets/adguard_ca.pem ] || { : > secrets/adguard_ca.pem; chmod 600 secrets/adguard_ca.pem; }
if [ "$mode" = bundled ]; then
  url=$BUNDLED_ADGUARD_URL user=familytime ca=0
  # The household's own AdGuard password never becomes the bundled AdGuard's: a new one is made.
  if [ "$had_mode" = external ] && [ -s secrets/adguard_password ]; then
    rm -f secrets/adguard_password
    echo "  removed  secrets/adguard_password (your own AdGuard's; the bundled one gets its own)"
  fi
  make_secret adguard_password 24
else
  url=${opt_url:-}
  [ -z "$url" ] && [ "$had_mode" = external ] && url=$had_url
  [ -z "$url" ] && url=$(ask "The address of your AdGuard's web page, like http://192.168.1.2:3000:" "")
  [ -n "$url" ] || { echo "init.sh: give the address of your AdGuard's web page: --adguard-url http://192.168.1.2:3000" >&2; exit 2; }
  user=${opt_user:-}
  [ -z "$user" ] && [ "$had_mode" = external ] && user=$had_user
  [ -z "$user" ] && user=$(ask "The AdGuard user Family time signs in as [familytime]:" familytime)
  # A certificate trusted for one address is not trusted for another.
  if [ "$url" != "$had_url" ] && [ "$ca" = 1 ] && [ -z "$opt_ca" ]; then
    ca=0
    echo "  note     the address changed, so the certificate trusted for $had_url is no longer used (--adguard-ca to trust one for $url)"
  fi
  if [ -n "$opt_ca" ]; then
    [ -s "$opt_ca" ] && grep -q 'BEGIN CERTIFICATE' "$opt_ca" || { echo "init.sh: $opt_ca is not a PEM certificate" >&2; exit 2; }
    # Exactly one certificate, and AdGuard's own, never an authority that could vouch for others.
    [ "$(grep -c 'BEGIN CERTIFICATE' "$opt_ca")" = 1 ] || { echo "init.sh: $opt_ca holds more than one certificate. Give AdGuard's own certificate only." >&2; exit 2; }
    if openssl x509 -in "$opt_ca" -noout -ext basicConstraints 2>/dev/null | grep -q 'CA:TRUE'; then
      echo "init.sh: $opt_ca is a certificate authority (CA:TRUE), which could vouch for other servers. Make AdGuard a certificate that is not a CA (docs/setup/network.md)." >&2
      exit 2
    fi
    cp "$opt_ca" secrets/adguard_ca.pem.tmp && chmod 600 secrets/adguard_ca.pem.tmp && mv secrets/adguard_ca.pem.tmp secrets/adguard_ca.pem
    ca=1
    echo "  set      secrets/adguard_ca.pem (trusted for $url only through ADGUARD_CA=1)"
  fi
  # The password: asked for when new, when moving from the bundled AdGuard, or when asked to.
  if [ "$opt_new_pw" = 1 ] || [ "$had_mode" != external ] || [ ! -s secrets/adguard_password ]; then
    if [ "$opt_pw_stdin" = 1 ]; then
      IFS= read -r pw || true
    elif [ -r /dev/tty ] && [ -t 0 ]; then
      IFS= read -rsp "The password of AdGuard user $user (not shown): " pw < /dev/tty; echo
      IFS= read -rsp "The same again: " pw2 < /dev/tty; echo
      [ "$pw" = "$pw2" ] || { echo "init.sh: the two passwords differ. Nothing was saved; run this again." >&2; exit 2; }
    else
      echo "init.sh: the AdGuard password is needed. Run this in a terminal, or pass it on standard input with --adguard-password-stdin." >&2
      exit 2
    fi
    [ -n "$pw" ] || { echo "init.sh: the AdGuard password is empty. Nothing was saved." >&2; exit 2; }
    tmp=$(mktemp "secrets/.adguard_password.XXXXXX")
    printf '%s' "$pw" > "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" secrets/adguard_password
    unset pw pw2
    echo "  set      secrets/adguard_password (not shown)"
  else
    echo "  kept     secrets/adguard_password"
  fi
fi

# Written to a temporary file and checked the way every script reads it, then put in place.
new="ADGUARD_MODE=$mode
ADGUARD_URL=$url
ADGUARD_USER=$user
ADGUARD_CA=$ca
ADGUARD_ALLOW_UNTESTED=$had_untested"
old=$(cat deploy/.state/adguard.env 2>/dev/null || true)
if [ "$new" = "$old" ]; then
  echo "  kept     deploy/.state/adguard.env ($mode, $url, user $user)"
else
  printf '%s\n' "$new" > deploy/.state/adguard.env.tmp
  if ! why=$(load_adguard_env deploy/.state/adguard.env.tmp 2>&1); then
    rm -f deploy/.state/adguard.env.tmp
    echo "init.sh: $why" >&2
    exit 2
  fi
  mv deploy/.state/adguard.env.tmp deploy/.state/adguard.env
  if [ -n "$old" ]; then echo "  updated  deploy/.state/adguard.env ($mode, $url, user $user)"; else echo "  created  deploy/.state/adguard.env ($mode, $url, user $user)"; fi
fi
if [ "$mode" = external ] && command -v curl >/dev/null; then
  load_adguard_env
  if [[ "$url" == http://* ]]; then
    echo "  warning  $url is plain http: the AdGuard password crosses your network unencrypted every minute. Use https if AdGuard offers it, give Family time its own AdGuard user with a password used nowhere else, and keep this server and AdGuard on a wired network (docs/setup/network.md)."
  fi
  if says=$(adguard_check); then
    echo "  checked  AdGuard at $url: reachable, login works, version supported"
    [ -n "$says" ] && echo "  note     ${says#warn }"
  else
    echo "  problem  $says"
    echo "           Fix it, then run ./scripts/init.sh again. ./scripts/update.sh checks the same thing first."
  fi
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
