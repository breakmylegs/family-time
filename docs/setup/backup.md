# Backups and restoring

Family time backs itself up every night at 02:30 into two encrypted restic repositories: one for the family's data, one for the keys. The design is in ADR 0017.

## Set up, once

```bash
sudo apt install restic
sudo ./scripts/init.sh           # adds the two passwords and deploy/.state/backup.env
./scripts/update.sh
sudo cp deploy/systemd/family-time-backup.service deploy/systemd/family-time-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now family-time-backup.timer
sudo ./scripts/backup.sh         # the first one now, by hand
sudo ./scripts/restore.sh        # and prove it restores
```

Then write down the keys repository's password, `secrets/restic_keys_password`, and keep it somewhere that is not this server, for example a password manager. Without it, a new server cannot get the keys back.

### Somewhere other than this disk

By default both repositories are folders under `/var/backups/family-time`. That protects against mistakes, not against the disk failing. Edit `deploy/.state/backup.env` to point at another disk or a remote restic supports, for example:

```
BACKUP_REPO=/mnt/usb-backup/family-time/data
BACKUP_KEYS_REPO=/mnt/usb-backup/family-time/keys
```

The next backup makes the new repositories.

## Every night

`backup.sh` dumps the database and checks the dump, copies AdGuard's settings (and the Besu chain, with Besu stopped for a moment, if it is switched on), stores the snapshot, copies `secrets/` into the keys repository, checks both, and only then forgets old snapshots: 7 daily, 4 weekly, 6 monthly.

The System page (Settings, then System) shows the last backup. If one fails, or none has worked for a day and a half, owners get an alert on their phones.

## The drill

```bash
sudo ./scripts/restore.sh                    # the latest snapshot
sudo ./scripts/restore.sh --list             # the snapshots there are
sudo ./scripts/restore.sh --snapshot 1a2b3c4d
```

The drill restores into a separate, throwaway database with no network, checks the tables, the rows and the migrations, reads AdGuard's settings, checks the keys repository, and removes it. Nothing live is touched. Run it after the first backup and once a month. Paste the output into the build chat if anything says FAILED.

## A new server

1. Set up the server as in `docs/setup/server.md`, and clone Family time.
2. `sudo ./scripts/restore.sh --keys --repo /path/to/keys-repository` and type the keys password. This puts `secrets/` and the state files back.
3. `sudo ./scripts/init.sh` adds anything missing, without replacing what was restored.
4. `./scripts/update.sh` deploys an empty stack.
5. `sudo ./scripts/restore.sh --live` and type `restore live`. This puts the data back and starts everything.
6. `./scripts/verify.sh --url https://your-family-address` should be all green.

`--live` also works on the same server, to go back to last night. It keeps a copy of the database as it was, in `backups/pre-restore/`, first.

## Checking the server

```bash
./scripts/verify.sh
./scripts/verify.sh --url https://family.example.com
```

It checks the app is healthy and is the version deployed, the kiosk answers on the LAN, home DNS answers, and that AdGuard's admin, Besu and Postgres cannot be reached from outside Docker. 0 means all green, 1 a finding, 2 the app could not be reached.

## Maintenance mode

```bash
./scripts/ft.sh maintenance --state on --message "Back by 21:00."
./scripts/ft.sh maintenance --state off
```

While it is on, the app shows the message and the kiosk says it is having a tidy-up. Allow, Block and Pause on Control still work; other changes wait. Everything already set keeps working, bedtime included.
