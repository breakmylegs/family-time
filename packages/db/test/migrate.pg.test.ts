// Real Postgres. Runs in the deploy's throwaway test project, where DATABASE_URL is set.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { appliedMigrationCount, migrationsFolder, recordHeartbeat, readHeartbeat, shippedMigrationCount, type Db } from '../src/index.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. These tests run only in the deploy test project.');
const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool) as unknown as Db;
afterAll(() => pool.end());

describe('on real Postgres', () => {
  it('applies every migration, twice without error', async () => {
    await migrate(drizzle(pool), { migrationsFolder });
    await migrate(drizzle(pool), { migrationsFolder });
    expect(await appliedMigrationCount(db)).toBe(shippedMigrationCount());
  });

  it('writes and reads the heartbeat', async () => {
    const at = new Date('2026-10-26T10:00:00Z');
    await recordHeartbeat(db, 'pgtest', at);
    expect(await readHeartbeat(db)).toEqual({ beatAt: at, commit: 'pgtest', chainSeenAt: null, adguardSeenAt: null });
  });
});
