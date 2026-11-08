// Real Postgres and real pg-boss. Runs in the deploy's throwaway test project, after the db
// package's tests have migrated the database.
import { readHeartbeat, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, it } from 'vitest';
import { jsonLog, startWorker } from '../src/worker.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. These tests run only in the deploy test project.');
const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool, { schema }) as unknown as Db;
afterAll(() => pool.end());

describe('worker on real Postgres', () => {
  it('writes the heartbeat through pg-boss', async () => {
    const at = new Date('2026-10-26T19:00:00Z');
    const worker = await startWorker({
      boss: new PgBoss({ connectionString: url }),
      db,
      commit: 'pgworker',
      now: () => at,
      log: jsonLog('worker', 'error'),
      pollingIntervalSeconds: 0.5,
    });
    try {
      const end = Date.now() + 20_000;
      let beat = await readHeartbeat(db);
      while (beat?.commit !== 'pgworker' && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 250));
        beat = await readHeartbeat(db);
      }
      expect(beat).toEqual({ beatAt: at, commit: 'pgworker', chainSeenAt: null });
    } finally {
      await worker.stop();
    }
  });
});
