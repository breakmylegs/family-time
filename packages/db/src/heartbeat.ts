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

/** The worker reached the Besu node just now. Only ever after a beat, so the row is there. */
export async function recordChainSeen(db: Db, at: Date): Promise<void> {
  await db.update(workerHeartbeat).set({ chainSeenAt: at }).where(eq(workerHeartbeat.id, 1));
}

/** Two minutes: a few of the signer's five-second passes, with room for a node restart. */
export const CHAIN_STALE_AFTER_MS = 120_000;

export async function readHeartbeat(db: Db): Promise<{ beatAt: Date; commit: string; chainSeenAt: Date | null } | undefined> {
  const rows = await db
    .select({ beatAt: workerHeartbeat.beatAt, commit: workerHeartbeat.commit, chainSeenAt: workerHeartbeat.chainSeenAt })
    .from(workerHeartbeat)
    .where(eq(workerHeartbeat.id, 1));
  return rows[0];
}

/** A beat from the future (clock skew between containers) counts as fresh. */
export function heartbeatFresh(beatAt: Date | undefined, now: Date): boolean {
  if (!beatAt) return false;
  return now.getTime() - beatAt.getTime() <= HEARTBEAT_STALE_AFTER_MS;
}
