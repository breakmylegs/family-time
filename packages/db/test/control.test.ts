import { decide } from '@family-time/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { grants, households, loadRules, overrides, people, policies, schedules, serviceGroupMembers, serviceGroups, services } from '../src/index.js';
import { testDb, type TestDb } from '../src/testing.js';

let handle: TestDb | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

// Monday 26 October 2026, 16:00 in London (GMT, so 16:00Z).
const NOW = new Date('2026-10-26T16:00:00Z');

async function seed(h: TestDb) {
  const db = h.db;
  const [hh] = await db.insert(households).values({ name: 'Test' }).returning();
  const [mum] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Mum', role: 'owner' }).returning();
  const [ollie] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Ollie', role: 'child' }).returning();
  const [youtube] = await db.insert(services).values({ householdId: hh!.id, name: 'YouTube', source: 'adguard', adguardId: 'youtube' }).returning();
  const [roblox] = await db.insert(services).values({ householdId: hh!.id, name: 'Roblox', source: 'adguard', adguardId: 'roblox' }).returning();
  const [games] = await db.insert(serviceGroups).values({ householdId: hh!.id, name: 'Games' }).returning();
  await db.insert(serviceGroupMembers).values({ groupId: games!.id, serviceId: roblox!.id });
  await db.insert(policies).values({ childId: ollie!.id, groupId: games!.id, defaultState: 'blocked' });
  await db.insert(schedules).values({
    householdId: hh!.id,
    name: 'School night',
    weekdays: [1, 2, 3, 4, 5],
    blocks: [
      { type: 'school', start: '08:30', end: '15:30' },
      { type: 'bed', start: '20:30', end: '07:00' },
    ],
  });
  return { hh: hh!, mum: mum!, ollie: ollie!, youtube: youtube!, roblox: roblox!, games: games! };
}

describe('loadRules', () => {
  it('reads services with their groups, policies, schedules and live overrides into the engine', async () => {
    handle = await testDb();
    const s = await seed(handle);
    await handle.db.insert(overrides).values({
      householdId: s.hh.id,
      childId: s.ollie.id,
      targetKind: 'group',
      targetId: s.games.id,
      type: 'allow',
      startsAt: new Date('2026-10-26T15:50:00Z'),
      endsAt: new Date('2026-10-26T17:00:00Z'),
      createdBy: s.mum.id,
    });
    const rules = await loadRules(handle.db, s.ollie.id, NOW);
    expect(rules.childName).toBe('Ollie');
    expect(rules.timeZone).toBe('Europe/London');
    expect(rules.services.find((x) => x.id === s.roblox.id)?.groupIds).toEqual([s.games.id]);
    expect(decide(rules, s.roblox.id, NOW)).toMatchObject({ state: 'allowed', reason: 'Mum allowed it.', until: new Date('2026-10-26T17:00:00Z') });
    expect(decide(rules, s.youtube.id, NOW)).toMatchObject({ state: 'blocked', reason: 'Not planned today. Usual school night rule.' });
    expect(decide(rules, s.youtube.id, new Date('2026-10-26T10:00:00Z')).reason).toBe('School time.');
  });

  it('leaves out overrides and grants that ended days ago, and refunded grants', async () => {
    handle = await testDb();
    const s = await seed(handle);
    await handle.db.insert(overrides).values({
      householdId: s.hh.id,
      childId: s.ollie.id,
      targetKind: 'everything',
      type: 'block',
      startsAt: new Date('2026-10-20T10:00:00Z'),
      endsAt: new Date('2026-10-20T11:00:00Z'),
      createdBy: s.mum.id,
    });
    await handle.db.insert(grants).values({
      householdId: s.hh.id,
      childId: s.ollie.id,
      targetKind: 'service',
      targetId: s.youtube.id,
      startsAt: new Date('2026-10-26T15:45:00Z'),
      endsAt: new Date('2026-10-26T16:15:00Z'),
      source: 'planned',
      status: 'refunded',
    });
    const rules = await loadRules(handle.db, s.ollie.id, NOW);
    expect(rules.overrides).toEqual([]);
    expect(rules.grants).toEqual([]);
  });

  it('refuses someone who is not an active child', async () => {
    handle = await testDb();
    const s = await seed(handle);
    await expect(loadRules(handle.db, s.mum.id, NOW)).rejects.toThrow(/No active child/);
  });

  it('refuses an override with no end unless it is a pause', async () => {
    handle = await testDb();
    const s = await seed(handle);
    await expect(
      handle.db.insert(overrides).values({ householdId: s.hh.id, childId: s.ollie.id, targetKind: 'everything', type: 'allow', startsAt: NOW, endsAt: null, createdBy: s.mum.id }),
    ).rejects.toThrow();
  });
});
