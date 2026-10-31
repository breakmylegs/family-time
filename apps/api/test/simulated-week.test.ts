// Phase 4's exit test: two weeks of a family's economy with the fake clock, on the Postgres ledger.
// Week one runs from Sunday 18 October 2026, 18:00 BST, across the clock change, to Sunday
// 25 October, 18:00 GMT. Every step is the same call the app or the kiosk makes.
import { households, overrides, people, policies, reductionPlans, schedules, serviceGroupMembers, serviceGroups, services, tasks, type Db } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import { zonedTime } from '@family-time/domain';
import { postgresLedger, type LedgerPort } from '@family-time/ledger';
import { economyTick } from '@family-time/worker/economy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  agreeStep,
  approveCompletion,
  approveRequest,
  askRequest,
  convertFlex,
  createTask,
  logCompletion,
  planSession,
  recordPayout,
  setPlan,
  weekSummary,
} from '../src/economy/commands.js';

/** A London wall-clock time: `L('2026-10-19 18:40')`. */
const L = (s: string) => {
  const [d, t] = s.split(' ') as [string, string];
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const [h, min] = t.split(':').map(Number) as [number, number];
  return zonedTime(y, m, day, h * 60 + min, 'Europe/London');
};

let handle: TestDb;
let db: Db;
let ledger: LedgerPort;
let hh: string;
let mum: string;
let ollie: string;
let youtube: string;
let roblox: string;
const quiet = () => undefined;
const tick = (at: string) => economyTick({ db, ledger, now: () => L(at), log: quiet });
const balances = () => ledger.balances(hh, ollie);

beforeAll(async () => {
  handle = await testDb();
  db = handle.db;
  ledger = postgresLedger(db);
  const [h] = await db.insert(households).values({ name: 'Test', pilotPhase: 'taper' }).returning();
  hh = h!.id;
  mum = (await db.insert(people).values({ householdId: hh, displayName: 'Mum', role: 'owner' }).returning())[0]!.id;
  ollie = (await db.insert(people).values({ householdId: hh, displayName: 'Ollie', role: 'child', pronouns: 'he' }).returning())[0]!.id;
  youtube = (await db.insert(services).values({ householdId: hh, name: 'YouTube', source: 'adguard', adguardId: 'youtube', domains: ['youtube.com'] }).returning())[0]!.id;
  roblox = (await db.insert(services).values({ householdId: hh, name: 'Roblox', source: 'adguard', adguardId: 'roblox', domains: ['roblox.com'] }).returning())[0]!.id;
  const [games] = await db.insert(serviceGroups).values({ householdId: hh, name: 'Games' }).returning();
  await db.insert(serviceGroupMembers).values({ groupId: games!.id, serviceId: roblox });
  await db.insert(policies).values({ childId: ollie, groupId: games!.id });
  await db.insert(schedules).values([
    {
      householdId: hh,
      name: 'School night',
      weekdays: [1, 2, 3, 4, 5],
      blocks: [
        { type: 'school', start: '08:30', end: '15:30' },
        { type: 'free', start: '15:30', end: '17:30' },
        { type: 'pause', start: '17:30', end: '18:15', label: 'Tea' },
        { type: 'free', start: '18:15', end: '19:30' },
        { type: 'wind-down', start: '19:30', end: '20:30' },
        { type: 'bed', start: '20:30', end: '07:00' },
      ],
    },
    { householdId: hh, name: 'Weekend', weekdays: [0, 6], blocks: [{ type: 'free', start: '08:00', end: '19:30' }, { type: 'bed', start: '20:30', end: '08:00' }] },
  ]);
});
afterAll(() => handle.close());

describe('a simulated fortnight', () => {
  it('week one: allowance, a session cut short by a Block, jobs, a request, a counted Allow, flex, a payout', async () => {
    // Sunday evening: the week starts with the agreed allowance. A reduction plan is set, not yet agreed.
    await tick('2026-10-18 18:05');
    expect(await balances()).toEqual({ time: 420, money: 0, flex: 0 });
    await setPlan(db, { householdId: hh, childId: ollie, by: mum, plan: { stepMinutes: 30, everyWeeks: 4, floorMinutes: 300, nextStepOn: '2026-10-25' } }, L('2026-10-18 18:10'));

    // Monday: Ollie plans YouTube 18:30 to 19:00. At 18:40 Mum blocks YouTube for 30 minutes.
    const session = await planSession(db, ledger, { childId: ollie, target: { kind: 'service', id: youtube }, start: L('2026-10-19 18:30'), minutes: 30 }, L('2026-10-19 16:00'));
    expect((await balances()).time).toBe(390);
    await db.insert(overrides).values({
      householdId: hh,
      childId: ollie,
      targetKind: 'service',
      targetId: youtube,
      type: 'block',
      startsAt: L('2026-10-19 18:40'),
      endsAt: L('2026-10-19 19:10'),
      createdBy: mum,
    });
    // After the session: the 20 minutes the Block took go back to him, once, however often the worker runs.
    await tick('2026-10-19 19:05');
    await tick('2026-10-19 19:06');
    expect((await balances()).time).toBe(410);
    expect(session).toMatch(/^[0-9a-f-]{36}$/);

    // Jobs: money, flex, time (capped at 15% of 7 h, 63 minutes) and praise only.
    const job = (title: string, rewardType: 'money' | 'flex' | 'time' | 'praise', amount: number) =>
      createTask(db, { householdId: hh, by: mum, task: { title, picture: 'star', rewardType, amount, recurrence: { kind: 'daily' }, ageBand: null, needsPhoto: false, childId: null } }, L('2026-10-18 18:00'));
    const dishes = await job('Emptied the dishwasher', 'money', 50);
    const tidy = await job('Tidied the bedroom', 'flex', 20);
    const reading = await job('Read for half an hour', 'time', 30);
    const garden = await job('Helped in the garden', 'time', 45);
    const lego = await job('Built something with LEGO', 'praise', 0);
    const approve = async (taskId: string, at: string, note: string | null = null) => {
      const id = await logCompletion(db, { childId: ollie, taskId }, L(at));
      return approveCompletion(db, ledger, { householdId: hh, completionId: id, by: mum, note }, L(at));
    };
    expect((await approve(dishes.id, '2026-10-20 17:05', 'Thank you, that really helped')).paid).toMatchObject({ currency: 'MONEY', amount: 50 });
    expect((await approve(tidy.id, '2026-10-20 17:10')).paid).toMatchObject({ currency: 'FLEX', amount: 20 });
    expect((await approve(reading.id, '2026-10-20 18:20')).paid).toMatchObject({ currency: 'TIME', amount: 30 });
    // Only 33 minutes of the cap are left, so the garden job pays 33, not 45.
    expect((await approve(garden.id, '2026-10-21 16:00')).paid).toMatchObject({ currency: 'TIME', amount: 33 });
    expect((await approve(lego.id, '2026-10-21 16:30', 'Love the lighthouse')).paid).toBeNull();
    // A daily job is once a day.
    await expect(logCompletion(db, { childId: ollie, taskId: dishes.id }, L('2026-10-20 19:00'))).rejects.toThrow(/done for today/);
    expect(await balances()).toEqual({ time: 473, money: 50, flex: 20 });

    // Wednesday: Ollie asks for Roblox at 17:00; Mum says yes, from his allowance.
    const ask = await askRequest(db, { childId: ollie, target: { kind: 'service', id: roblox }, start: L('2026-10-21 17:00'), minutes: 30, detail: 'Can I play Roblox with Jamie?' }, L('2026-10-21 16:40'));
    await approveRequest(db, ledger, { householdId: hh, requestId: ask, by: mum, asExtra: false }, L('2026-10-21 16:45'));
    expect((await balances()).time).toBe(443);

    // Thursday: Mum allows Roblox for 30 minutes, counted in his weekly time. Charged when it ends.
    await db.insert(overrides).values({
      householdId: hh,
      childId: ollie,
      targetKind: 'service',
      targetId: roblox,
      type: 'allow',
      startsAt: L('2026-10-22 16:00'),
      endsAt: L('2026-10-22 16:30'),
      countsAgainstAllowance: true,
      createdBy: mum,
    });
    await tick('2026-10-22 16:31');
    await tick('2026-10-22 16:32');
    expect((await balances()).time).toBe(413);

    // Friday: 10 flex points into pocket money; Saturday: Mum pays out 20p.
    await convertFlex(db, ledger, { householdId: hh, childId: ollie, by: mum, points: 10, to: 'MONEY', key: '00000000-0000-4000-8000-000000000001' }, L('2026-10-23 18:00'));
    await recordPayout(db, ledger, { householdId: hh, childId: ollie, by: mum, pence: 20, key: '00000000-0000-4000-8000-000000000002' }, L('2026-10-24 10:00'));
    expect(await balances()).toEqual({ time: 413, money: 40, flex: 10 });

    // The summary the Control screen shows.
    const summary = await weekSummary(db, ledger, ollie, L('2026-10-24 10:00'));
    expect(summary).toMatchObject({ allowanceMinutes: 420, leftMinutes: 413, earnedMinutes: 63, earnedCapMinutes: 63, moneyPence: 40, flexPoints: 10, resets: 'Sunday at 18:00' });
    expect(summary.usedMinutes).toBe(10 + 30 + 30); // 10 of the cut session, the request, the Allow
  });

  it('the week closes at 18:00 GMT after the clock change: bonus up to the cap, the rest expires, no step without agreement', async () => {
    await tick('2026-10-25 17:59');
    expect((await balances()).time).toBe(413); // not yet: the reset is 18:00 local
    await tick('2026-10-25 18:01');
    // 413 minutes left is 13 full blocks, 130p, capped at £1. The new week starts at 7 h: the step
    // was due on 25 October but nobody ticked it agreed.
    expect(await balances()).toEqual({ time: 420, money: 140, flex: 10 });
    const close = (await ledger.history(hh, ollie)).find((x) => x.kind === 'close')!;
    expect(close).toMatchObject({ time: -413, money: 100, at: new Date('2026-10-25T18:00:00Z') });
    const week = (await ledger.history(hh, ollie)).find((x) => x.kind === 'allowance' && x.data.week === '2026-10-25')!;
    expect(week).toMatchObject({ time: 420, at: new Date('2026-10-25T18:00:00Z') });
  });

  it('week two: the step is agreed at the review, he uses most of his time, and the next week is a step lower', async () => {
    await agreeStep(db, { householdId: hh, childId: ollie, by: mum }, L('2026-10-25 19:00'));
    for (const day of ['2026-10-26', '2026-10-27', '2026-10-28']) {
      await planSession(db, ledger, { childId: ollie, target: { kind: 'service', id: youtube }, start: L(`${day} 15:30`), minutes: 120 }, L(`${day} 15:30`));
    }
    await tick('2026-10-29 12:00');
    expect((await balances()).time).toBe(60);

    // The server was off over the weekend and comes back on Monday: it catches up.
    await tick('2026-11-02 07:30');
    // 60 minutes left: 20p. The agreed step applies: 7 h less 30 minutes.
    expect(await balances()).toEqual({ time: 390, money: 160, flex: 10 });
    const [plan] = await db.select().from(reductionPlans);
    expect(plan).toMatchObject({ nextStepOn: '2026-11-29', agreedStepOn: null });
    expect((await weekSummary(db, ledger, ollie, L('2026-11-02 07:30'))).lastWeek).toEqual({ minutesLeft: 60, bonusPence: 20 });
  });

  it('keeps one unbroken chain, and a second run of everything changes nothing', async () => {
    const before = await ledger.history(hh, ollie);
    await tick('2026-11-02 07:31');
    await tick('2026-11-02 07:32');
    expect(await ledger.history(hh, ollie)).toHaveLength(before.length);
    expect(await ledger.verify(hh)).toMatchObject({ ok: true, checked: before.length });
    expect(await db.select().from(tasks)).toHaveLength(5);
  });
});
