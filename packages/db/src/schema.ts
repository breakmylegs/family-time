import { sql } from 'drizzle-orm';
import { check, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * One row, written by the worker's heartbeat job. Readiness reads it, so a stale row means the
 * job queue has stopped, not just that the worker process is up.
 */
export const workerHeartbeat = pgTable(
  'worker_heartbeat',
  {
    id: smallint('id').primaryKey().default(1),
    beatAt: timestamp('beat_at', { withTimezone: true }).notNull(),
    commit: text('commit').notNull(),
  },
  (t) => [check('worker_heartbeat_single_row', sql`${t.id} = 1`)],
);
