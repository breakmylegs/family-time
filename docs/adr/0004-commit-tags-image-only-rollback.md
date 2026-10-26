# ADR 0004: Images tagged by commit, rollback swaps images only

Status: accepted, 26 October 2026 (Phase 0 plan approved)

## Decision

- Every deploy builds `family-time:<12-character commit>`. `deploy/.state/current` records the running tag, `deploy/.state/previous` the one before, and `deploy/.state/image.env` gives Compose and systemd the tag.
- If the new version does not pass its health checks, or `/version` names a different commit, `update.sh` starts the previous tag again and exits 21. It never restores the database.
- Migrations are additive only. `packages/db/test/migrations.test.ts` fails on DROP, RENAME, a type change, SET NOT NULL, a NOT NULL column with no default, TRUNCATE or DELETE.
- Before migrating, `update.sh` takes a `pg_dump` of the live database, checked for size, and keeps the newest ten. Restoring one is a decision a person makes.
- After a good deploy, every image except the current and previous tags is removed.

## Why

The brief asks for commit tags and automatic rollback. The other platforms learnt that rolling a database back automatically loses data written since the deploy, so they roll back code only. That works only if the old code still runs on the new schema, which is what additive migrations guarantee.

## Consequences

- A change that must remove or reshape something is done in two deploys: add the new shape and stop using the old one, then remove the old one in a later deploy, with its own reviewed exception.
- `scripts/drill-rollback.sh` proves the rollback on the server by deploying a build that is never ready.
