import { eq } from 'drizzle-orm';
import { workerHeartbeat } from './schema.js';
import type { Db } from './types.js';

/** Three missed beats at the worker's 30 second interval. */
export const HEARTBEAT_STALE_AFTER_MS = 90_000;

export async function recordHeartbeat(db: Db, commit: string, at: Date): Promise<void> {
  await db
    .insert(workerHeartbeat)
    .values({ id: 1, beatAt: at, commit })
    .onConflictDoUpdate({ target: workerHeartbeat.id, set: { beatAt: at, commit } });
}

export async function readHeartbeat(db: Db): Promise<{ beatAt: Date; commit: string } | undefined> {
  const rows = await db
    .select({ beatAt: workerHeartbeat.beatAt, commit: workerHeartbeat.commit })
    .from(workerHeartbeat)
    .where(eq(workerHeartbeat.id, 1));
  return rows[0];
}

/** A beat from the future (clock skew between containers) counts as fresh. */
export function heartbeatFresh(beatAt: Date | undefined, now: Date): boolean {
  if (!beatAt) return false;
  return now.getTime() - beatAt.getTime() <= HEARTBEAT_STALE_AFTER_MS;
}
