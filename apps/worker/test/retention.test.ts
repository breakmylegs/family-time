// Retention and backup health (Phase 8): old rows go on schedule and the sweep audits itself;
// young rows, ledger entries and anything still waiting stay; a failed or stale backup is a
// problem for the owners, and no backup set up yet is not.
import { auditEvents, oauthClients, oauthTokens, proposals, sessions, settings, sweep, usageMinutes } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { familyAlert } from '../src/alerts.js';
import { backupProblem, SETTING_LAST_BACKUP } from '../src/backups.js';
import { seedHome } from './seed.js';

let handle: TestDb;
beforeEach(async () => {
  handle = await testDb();
});
afterEach(async () => handle.close());

const NOW = new Date('2026-11-01T03:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('retention', () => {
  it('deletes only what is past its period, and audits what it deleted', async () => {
    const s = await seedHome(handle.db);
    const { db } = handle;
    await db.insert(sessions).values([
      { idHash: 'old', personId: s.mum.id, expiresAt: daysAgo(31) },
      { idHash: 'young', personId: s.mum.id, expiresAt: daysAgo(29) },
    ]);
    const [client] = await db.insert(oauthClients).values({ householdId: s.hh.id, clientUri: 'https://a.example/c.json', name: 'A' }).returning();
    await db.insert(oauthTokens).values([
      { tokenHash: 't1', kind: 'access', family: client!.id, clientId: client!.id, personId: s.mum.id, scope: 'read', expiresAt: daysAgo(40) },
      { tokenHash: 't2', kind: 'refresh', family: client!.id, clientId: client!.id, personId: s.mum.id, scope: 'read', expiresAt: daysAgo(-10) },
    ]);
    await db.insert(proposals).values([
      { householdId: s.hh.id, childId: s.ollie.id, source: 'ai', kind: 'pause', payload: {}, summary: 'old', status: 'declined', expiresAt: daysAgo(100), decidedAt: daysAgo(100) },
      { householdId: s.hh.id, childId: s.ollie.id, source: 'ai', kind: 'pause', payload: {}, summary: 'waiting', status: 'waiting', expiresAt: daysAgo(100) },
    ]);
    await db.insert(usageMinutes).values([
      { deviceId: s.ipad.id, serviceId: s.youtube.id, minute: daysAgo(400), queries: 3 },
      { deviceId: s.ipad.id, serviceId: s.youtube.id, minute: daysAgo(10), queries: 3 },
    ]);

    const counts = await sweep(db, NOW);
    expect(counts).toEqual({ sessions: 1, oauth_tokens: 1, proposals: 1, usage_minutes: 1 });
    expect((await db.select().from(sessions)).map((x) => x.idHash)).toEqual(['young']);
    expect((await db.select().from(proposals)).map((x) => x.summary)).toEqual(['waiting']);
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'retention.swept'));
    expect(event).toMatchObject({ actorLabel: 'retention', after: counts });

    // A second sweep finds nothing, and says nothing.
    expect(await sweep(db, NOW)).toEqual({});
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'retention.swept'))).toHaveLength(1);
  });
});

describe('backup health', () => {
  const record = async (hh: string, value: object) => handle.db.insert(settings).values({ householdId: hh, key: SETTING_LAST_BACKUP, value }).onConflictDoUpdate({ target: [settings.householdId, settings.key], set: { value } });

  it('says nothing until backups are set up, then speaks up about a failure or a long gap', async () => {
    const s = await seedHome(handle.db);
    expect(await backupProblem(handle.db, s.hh.id, NOW)).toBeNull();
    await record(s.hh.id, { at: daysAgo(0.5).toISOString(), ok: true, lastOkAt: daysAgo(0.5).toISOString(), bytes: 900_000, snapshot: 'abc', problem: null });
    expect(await backupProblem(handle.db, s.hh.id, NOW)).toBeNull();
    await record(s.hh.id, { at: daysAgo(0.1).toISOString(), ok: false, lastOkAt: daysAgo(0.5).toISOString(), bytes: null, snapshot: null, problem: 'the dump was smaller than 64 KB' });
    expect(await backupProblem(handle.db, s.hh.id, NOW)).toBe("Last night's backup didn't finish: the dump was smaller than 64 KB.");
    await record(s.hh.id, { at: daysAgo(2).toISOString(), ok: true, lastOkAt: daysAgo(2).toISOString(), bytes: 900_000, snapshot: 'abc', problem: null });
    expect(await backupProblem(handle.db, s.hh.id, NOW)).toBe('There has been no backup for more than a day and a half.');
    expect(await familyAlert(handle.db, { kind: 'backup', householdId: s.hh.id, problem: 'x.' })).toMatchObject({ to: 'owners', alert: { title: 'The backup needs a look', path: '/system' } });
  });
});
