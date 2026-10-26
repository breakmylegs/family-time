// Real Postgres. Runs in the deploy's throwaway test project, after the db package's tests have
// migrated the database.
import { recordHeartbeat, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { readBuildInfo } from '../src/build.js';
import { buildServer } from '../src/server.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. These tests run only in the deploy test project.');
const pool = new pg.Pool({ connectionString: url });
const db = drizzle(pool, { schema }) as unknown as Db;
afterAll(() => pool.end());

describe('api on real Postgres', () => {
  it('is ready once the schema is migrated and the worker has beaten', async () => {
    const now = new Date();
    await recordHeartbeat(db, 'pgapi', now);
    const app = await buildServer({ db, build: readBuildInfo({ GIT_COMMIT: 'pgapi' }), now: () => now, logLevel: 'error' });
    try {
      const res = await app.inject('/readyz');
      expect(res.json()).toMatchObject({ status: 'ready' });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
