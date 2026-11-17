// Real Postgres (ADR 0021): the kiosk's limits hold when taps arrive together. PGlite runs one
// query at a time, so only a real server with a pool of connections can show the per-child lock
// working. Runs in the deploy's throwaway test project, after the db package has migrated.
import { journal, ruleAsks, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { addJournal, askAboutRule, MAX_JOURNAL_PER_DAY, MAX_OPEN_RULE_ASKS } from '../src/family/extras.js';
import { seedHousehold, seedPerson } from './accounts.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. These tests run only in the deploy test project.');
const pool = new pg.Pool({ connectionString: url, max: 10 });
const db = drizzle(pool, { schema }) as unknown as Db;
afterAll(() => pool.end());

describe('kiosk limits on real Postgres', () => {
  it('lets exactly the limit through when many taps arrive at once', async () => {
    const hh = await seedHousehold(db);
    const child = await seedPerson(db, hh, 'child', 'Lock test');
    const now = new Date();

    const did = await Promise.allSettled(Array.from({ length: MAX_JOURNAL_PER_DAY + 5 }, (_, i) => addJournal(db, { householdId: hh, childId: child, text: `Thing ${i}`, picture: 'star' }, now)));
    expect(did.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_JOURNAL_PER_DAY);
    expect(await db.select().from(journal).where(eq(journal.childId, child))).toHaveLength(MAX_JOURNAL_PER_DAY);

    const asked = await Promise.allSettled(Array.from({ length: MAX_OPEN_RULE_ASKS + 3 }, (_, i) => askAboutRule(db, { householdId: hh, childId: child, text: `Question ${i}` }, now)));
    expect(asked.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_OPEN_RULE_ASKS);
    expect(await db.select().from(ruleAsks).where(eq(ruleAsks.childId, child))).toHaveLength(MAX_OPEN_RULE_ASKS);
  });
});
