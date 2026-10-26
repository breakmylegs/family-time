#!/bin/sh
# Starts as root only long enough to hand the Docker secrets to the unprivileged `node` user, then
# drops to it for good. Compose mounts secrets with the host file's owner and mode (root, 0600),
# which `node` could not read. The copies live on a tmpfs, never in the image or on disk.
set -eu

if [ "$(id -u)" = "0" ]; then
  if [ -d /run/secrets ]; then
    mkdir -p /run/app-secrets
    for f in /run/secrets/*; do
      [ -f "$f" ] || continue
      cp "$f" /run/app-secrets/
    done
    chown -R node:node /run/app-secrets
    chmod 0500 /run/app-secrets
    find /run/app-secrets -type f -exec chmod 0400 {} +
  fi
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

exec "$@"
