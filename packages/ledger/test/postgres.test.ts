import { households, ledgerEntries, people } from '@family-time/db';
import { testDb } from '@family-time/db/testing';
import { describe, expect, it } from 'vitest';
import { canonicalJson, postgresLedger } from '../src/index.js';
import { ledgerSuite } from './suite.js';

async function fixture() {
  const handle = await testDb();
  const [hh] = await handle.db.insert(households).values({ name: 'Test' }).returning();
  const [a] = await handle.db.insert(people).values({ householdId: hh!.id, displayName: 'Ollie', role: 'child' }).returning();
  const [b] = await handle.db.insert(people).values({ householdId: hh!.id, displayName: 'Jamie', role: 'child' }).returning();
  return { handle, ledger: postgresLedger(handle.db), householdId: hh!.id, childId: a!.id, otherChildId: b!.id, close: handle.close };
}

ledgerSuite('Postgres (PGlite)', fixture);

describe('the Postgres ledger', () => {
  it('refuses any change to a written entry, whatever path it comes from', async () => {
    const f = await fixture();
    try {
      await f.ledger.award({ ref: 'job:1', householdId: f.householdId, childId: f.childId, reason: 'Dishes', at: new Date(), currency: 'MONEY', amount: 50 });
      await expect(f.handle.client.query('update ledger_entries set money = 5000')).rejects.toThrow(/append-only/);
      await expect(f.handle.client.query('delete from ledger_entries')).rejects.toThrow(/append-only/);
    } finally {
      await f.close();
    }
  });

  it('finds an entry changed behind its back, and says which', async () => {
    const f = await fixture();
    try {
      const base = { householdId: f.householdId, childId: f.childId, reason: 'Dishes', at: new Date('2026-10-26T17:05:00Z') };
      await f.ledger.award({ ...base, ref: 'job:1', currency: 'MONEY', amount: 50 });
      await f.ledger.award({ ...base, ref: 'job:2', currency: 'MONEY', amount: 50 });
      await f.ledger.award({ ...base, ref: 'job:3', currency: 'MONEY', amount: 50 });
      // Someone with the database password and the will to get round the trigger.
      await f.handle.client.exec(`alter table ledger_entries disable trigger ledger_entries_no_update_or_delete;
        update ledger_entries set money = 5000 where ref = 'job:2';
        alter table ledger_entries enable trigger ledger_entries_no_update_or_delete;`);
      expect(await f.ledger.verify(f.householdId)).toEqual({ ok: false, checked: 1, brokenAt: 2, problem: 'Entry 2 has been changed.' });
      await f.handle.client.exec(`alter table ledger_entries disable trigger ledger_entries_no_update_or_delete;
        delete from ledger_entries where ref = 'job:2';
        alter table ledger_entries enable trigger ledger_entries_no_update_or_delete;`);
      expect(await f.ledger.verify(f.householdId)).toMatchObject({ ok: false, brokenAt: 3, problem: 'Entry 2 is missing.' });
      expect(await f.handle.db.select().from(ledgerEntries)).toHaveLength(2);
    } finally {
      await f.close();
    }
  });

  it('hashes canonical JSON: key order and spacing make no difference', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: new Date('2026-10-26T17:05:00Z') } })).toBe('{"a":{"c":"2026-10-26T17:05:00.000Z","d":[2,{"x":2,"y":1}]},"b":1}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/whole numbers/);
  });
});
