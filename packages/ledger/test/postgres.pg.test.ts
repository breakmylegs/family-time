// The same contract on real Postgres, in the deploy's test project (DATABASE_URL is set there).
// Each test gets its own household, so the shared database needs no cleaning between them.
import { households, migrationsFolder, people, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { postgresLedger } from '../src/index.js';
import { ledgerSuite } from './suite.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. These tests run only in the deploy test project.');
// Several connections, so the race test really races on separate sessions.
const pool = new pg.Pool({ connectionString: url, max: 6 });
const db = drizzle(pool, { schema }) as unknown as Db;
beforeAll(() => migrate(drizzle(pool), { migrationsFolder }));
afterAll(() => pool.end());

ledgerSuite('Postgres (real)', async () => {
  const [hh] = await db.insert(households).values({ name: 'Ledger test' }).returning();
  const [a] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Ollie', role: 'child' }).returning();
  const [b] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Jamie', role: 'child' }).returning();
  return { ledger: postgresLedger(db), householdId: hh!.id, childId: a!.id, otherChildId: b!.id, close: async () => undefined };
});
