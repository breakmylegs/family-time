# ADR 0005: Secrets are files

Status: accepted, 26 October 2026 (Phase 0 plan approved)

## Decision

- `scripts/init.sh`, run as root on the server, creates every secret in `secrets/` (git-ignored, directory 0700, files 0600). It never replaces one that exists.
- Compose mounts them as Docker secrets. The image's entrypoint starts as root only to copy them to a tmpfs readable by the `node` user, then drops to `node` for good.
- Code reads `NAME_FILE` first, then `NAME`. A file that cannot be read, or is empty, is an error, never an empty secret.
- No setting has to live in `.env`. Settings that are not secret move into the app's own settings in later phases.

## Why

Secrets in environment variables leak into `docker inspect`, crash reports and child processes. Files mounted read-only do not. Copying them for the `node` user avoids running the app as root, without loosening the host file permissions.

## Consequences

- AI keys (Phase 7) are encrypted at rest with AES-256-GCM under `secrets/master_key`. Without it, AI features stay off; nothing falls back to a default key.
- Backups (Phase 8) copy `secrets/` into a separate encrypted restic repository.
