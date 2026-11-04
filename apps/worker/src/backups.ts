// Backup health (Phase 8, ADR 0017). backup.sh records each run with `ft.sh backup-recorded`, as
// the household setting `last_backup`. Until the first run nothing is said: backups are set up by
// the owner. After that, a failed run, or no good run for 36 hours, is a problem for the owners.
import { lastBackup, type Db } from '@family-time/db';

export { SETTING_LAST_BACKUP } from '@family-time/db';
export const BACKUP_STALE_MS = 36 * 3_600_000;

/** What is wrong with the backups, in a sentence, or null when nothing is (or none is set up yet). */
export async function backupProblem(db: Db, householdId: string, now: Date): Promise<string | null> {
  const b = await lastBackup(db, householdId);
  if (!b) return null;
  if (!b.ok) return `The last backup didn't finish: ${b.problem ?? 'no reason given'}.`;
  const good = b.lastOkAt ?? b.at;
  if (now.getTime() - new Date(good).getTime() > BACKUP_STALE_MS) return 'There has been no backup for more than a day and a half.';
  return null;
}