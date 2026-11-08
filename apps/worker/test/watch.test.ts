// Phase 9's alerts: AdGuard unwell for three minutes, and back; the family review an hour before
// the week resets, once a week and only while the economy is on.
import { AdGuard } from '@family-time/adguard-client';
import { FakeAdGuard } from '@family-time/adguard-client/fake';
import { households } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { familyAlert } from '../src/alerts.js';
import { ADGUARD_ALERT_AFTER, adguardProblem, AdGuardWatch, reviewsDue } from '../src/watch.js';
import { seedHome } from './seed.js';

let handle: TestDb;
beforeEach(async () => {
  handle = await testDb();
});
afterEach(async () => handle.close());

describe('AdGuard health', () => {
  it("says what is wrong: not answering, or protection off", async () => {
    const fake = new FakeAdGuard();
    const adguard = new AdGuard({ baseUrl: await fake.start(), username: fake.username, password: fake.password, timeoutMs: 2000 });
    expect(await adguardProblem(adguard)).toBeNull();
    fake.protectionEnabled = false;
    expect(await adguardProblem(adguard)).toBe('The blocking service has been switched off.');
    await fake.stop();
    expect(await adguardProblem(adguard)).toBe("The blocking service isn't answering.");
  });

  it('tells once after three unwell minutes in a row, and once when it is back', () => {
    const w = new AdGuardWatch();
    const turns = ['x', 'x', null, 'x', 'x', 'x', 'x', 'x', null, null].map((p) => w.observe(p));
    expect(ADGUARD_ALERT_AFTER).toBe(3);
    expect(turns).toEqual([undefined, undefined, undefined, undefined, undefined, 'down', undefined, undefined, 'up', undefined]);
  });

  it('alerts owners and parents in plain words', async () => {
    const s = await seedHome(handle.db);
    expect(await familyAlert(handle.db, { kind: 'adguard', householdId: s.hh.id, problem: "The blocking service isn't answering." })).toMatchObject({ to: 'parents', alert: { title: 'Blocking has stopped for now' } });
    expect(await familyAlert(handle.db, { kind: 'adguard', householdId: s.hh.id, problem: null })).toMatchObject({ alert: { title: 'Blocking is working again' } });
  });
});

describe('the family review reminder', () => {
  it('comes an hour before the week resets, once, and only with the economy on', async () => {
    const s = await seedHome(handle.db);
    // Sunday 25 October 2026; the week resets at 18:00 London (GMT).
    expect(await reviewsDue(handle.db, new Date('2026-10-25T17:15:00Z'))).toEqual([]);
    await handle.db.update(households).set({ pilotPhase: 'reframe' }).where(eq(households.id, s.hh.id));
    expect(await reviewsDue(handle.db, new Date('2026-10-25T16:30:00Z'))).toEqual([]);
    const due = await reviewsDue(handle.db, new Date('2026-10-25T17:15:00Z'));
    expect(due).toEqual([{ householdId: s.hh.id, resets: new Date('2026-10-25T18:00:00Z'), timeZone: 'Europe/London' }]);
    expect(await reviewsDue(handle.db, new Date('2026-10-25T17:30:00Z'))).toEqual([]);
    expect(await familyAlert(handle.db, { kind: 'review', householdId: s.hh.id, resets: '18:00' })).toMatchObject({
      to: 'parents',
      alert: { title: 'The family review is coming up', body: 'The week resets at 18:00. The agenda is ready on Family: how the week went, and what to agree for the next one.', path: '/family' },
    });
  });
});
