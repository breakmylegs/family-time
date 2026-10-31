import { completions, households, schedules, services } from '@family-time/db';
import { postgresLedger } from '@family-time/ledger';
import { ApprovalItem, ChainLedger, LedgerLine, Task, WeekSummary } from '@family-time/schemas';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { askRequest, logCompletion } from '../src/economy/commands.js';
import { seedHousehold, seedPerson, signedIn } from './accounts.js';
import { harness, type Harness } from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/** Monday 26 October 2026, 16:00 London, in a family on the reward-less pilot phase. */
async function setup(phase = 'reward-less') {
  let at = new Date('2026-10-26T16:00:00Z');
  h = await harness({ clock: () => at });
  const db = h.handle.db;
  const hh = await seedHousehold(db);
  await db.update(households).set({ pilotPhase: phase }).where(eq(households.id, hh));
  const mum = await seedPerson(db, hh, 'owner', 'Mum');
  const dad = await seedPerson(db, hh, 'parent', 'Dad');
  const gran = await seedPerson(db, hh, 'carer', 'Gran');
  const child = await seedPerson(db, hh, 'child', 'Ollie');
  const [roblox] = await db.insert(services).values({ householdId: hh, name: 'Roblox', source: 'adguard', adguardId: 'roblox', domains: ['roblox.com'] }).returning();
  await db.insert(schedules).values({
    householdId: hh,
    name: 'School night',
    weekdays: [1, 2, 3, 4, 5],
    blocks: [
      { type: 'school', start: '08:30', end: '15:30' },
      { type: 'free', start: '15:30', end: '19:30' },
      { type: 'wind-down', start: '19:30', end: '20:30' },
      { type: 'bed', start: '20:30', end: '07:00' },
    ],
  });
  const headers = { mum: await signedIn(db, mum), dad: await signedIn(db, dad), gran: await signedIn(db, gran) };
  return { db, app: h.app, hh, mum, child, roblox: roblox!, headers, advance: (ms: number) => void (at = new Date(at.getTime() + ms)), now: () => at };
}

const dishes = { title: 'Emptied the dishwasher', picture: 'dishes', rewardType: 'money', amount: 50, recurrence: { kind: 'daily' } };

async function job(s: Awaited<ReturnType<typeof setup>>, body: Record<string, unknown> = dishes) {
  const res = await s.app.inject({ method: 'POST', url: '/api/tasks', headers: s.headers.mum, payload: body });
  expect(res.statusCode).toBe(201);
  return Task.parse(res.json());
}

describe('jobs', () => {
  it('are made and changed by parents, read by everyone, and praise-only carries no points', async () => {
    const s = await setup();
    const task = await job(s);
    expect(task).toMatchObject({ title: 'Emptied the dishwasher', rewardLabel: '50p' });
    const praise = await s.app.inject({ method: 'POST', url: '/api/tasks', headers: s.headers.mum, payload: { ...dishes, title: 'LEGO', rewardType: 'praise', amount: 10 } });
    expect(praise.statusCode).toBe(400);
    expect((await s.app.inject({ method: 'POST', url: '/api/tasks', headers: s.headers.gran, payload: dishes })).statusCode).toBe(403);
    const list = Task.array().parse((await s.app.inject({ url: '/api/tasks', headers: s.headers.gran })).json());
    expect(list.map((t) => t.title)).toEqual(['Emptied the dishwasher']);
    expect((await s.app.inject({ method: 'DELETE', url: `/api/tasks/${task.id}`, headers: s.headers.mum })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/tasks', headers: s.headers.mum })).json()).toEqual([]);
  });
});

describe('approvals', () => {
  it('pays with a note, can be undone by the same parent for a minute, and is decided once', async () => {
    const s = await setup();
    const task = await job(s);
    const id = await logCompletion(s.db, { childId: s.child, taskId: task.id }, s.now());
    const list = ApprovalItem.array().parse((await s.app.inject({ url: '/api/approvals', headers: s.headers.mum })).json());
    expect(list).toEqual([expect.objectContaining({ kind: 'completion', id, title: 'Emptied the dishwasher', when: 'today at 16:00', willPay: { amount: 50, label: '50p' } })]);
    expect(list[0]!.kind === 'completion' && list[0]!.suggestions).toHaveLength(3);
    expect((await s.app.inject({ url: '/api/approvals/count', headers: s.headers.gran })).json()).toEqual({ waiting: 1 });

    const approve = await s.app.inject({ method: 'POST', url: `/api/completions/${id}/approve`, headers: s.headers.mum, payload: { note: 'Thank you, that really helped' } });
    expect(approve.statusCode).toBe(200);
    const twice = await s.app.inject({ method: 'POST', url: `/api/completions/${id}/approve`, headers: s.headers.dad, payload: {} });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().detail).toBe('Someone has already decided that one.');
    expect((await s.app.inject({ method: 'POST', url: `/api/completions/${id}/undo`, headers: s.headers.dad })).statusCode).toBe(409);
    const week = WeekSummary.parse((await s.app.inject({ url: `/api/children/${s.child}/week`, headers: s.headers.mum })).json());
    expect(week.moneyPence).toBe(50);

    s.advance(5_000);
    expect((await s.app.inject({ method: 'POST', url: `/api/completions/${id}/undo`, headers: s.headers.mum })).statusCode).toBe(200);
    expect(WeekSummary.parse((await s.app.inject({ url: `/api/children/${s.child}/week`, headers: s.headers.mum })).json()).moneyPence).toBe(0);
    const [c] = await s.db.select().from(completions).where(eq(completions.id, id));
    expect(c).toMatchObject({ status: 'waiting', note: null });
    // Approved again after the Undo: paid again, once.
    await s.app.inject({ method: 'POST', url: `/api/completions/${id}/approve`, headers: s.headers.gran, payload: { note: null } });
    expect(WeekSummary.parse((await s.app.inject({ url: `/api/children/${s.child}/week`, headers: s.headers.mum })).json()).moneyPence).toBe(50);
  });

  it('a request beyond the allowance can only be said yes to as extra, and only by a parent', async () => {
    const s = await setup();
    const ledger = postgresLedger(s.db);
    await ledger.allocateAllowance({ ref: 'a', householdId: s.hh, childId: s.child, reason: 'Week', at: s.now(), minutes: 0 });
    const id = await askRequest(s.db, { childId: s.child, target: { kind: 'service', id: s.roblox.id }, start: new Date('2026-10-26T17:00:00Z'), minutes: 30, detail: null }, s.now());
    const [item] = ApprovalItem.array().parse((await s.app.inject({ url: '/api/approvals', headers: s.headers.mum })).json());
    expect(item).toMatchObject({ kind: 'request', title: 'Roblox at 17:00', window: '17:00 to 17:30', extraOnly: true, blockedReason: null });
    expect(item!.kind === 'request' && item!.detail).toBe("They have planned all of this week's time, so a yes would be extra time on top, and wind-down starts at 19:30.");
    expect((await s.app.inject({ method: 'POST', url: `/api/requests/${id}/approve`, headers: s.headers.mum, payload: {} })).statusCode).toBe(409);
    expect((await s.app.inject({ method: 'POST', url: `/api/requests/${id}/approve`, headers: s.headers.gran, payload: { asExtra: true } })).statusCode).toBe(403);
    expect((await s.app.inject({ method: 'POST', url: `/api/requests/${id}/approve`, headers: s.headers.mum, payload: { asExtra: true } })).statusCode).toBe(200);
    expect((await ledger.balances(s.hh, s.child)).time).toBe(0);
  });

  it("are scoped to the family: another family's job cannot be approved", async () => {
    const s = await setup();
    const task = await job(s);
    const id = await logCompletion(s.db, { childId: s.child, taskId: task.id }, s.now());
    const otherHh = await seedHousehold(s.db);
    const stranger = await seedPerson(s.db, otherHh, 'owner', 'Stranger');
    const res = await s.app.inject({ method: 'POST', url: `/api/completions/${id}/approve`, headers: await signedIn(s.db, stranger), payload: {} });
    expect(res.statusCode).toBe(404);
    expect((await s.app.inject({ url: `/api/children/${s.child}/week`, headers: await signedIn(s.db, stranger) })).statusCode).toBe(404);
  });
});

describe('the ledger cannot be used to take points away', () => {
  it('an award undone cannot be reversed again with Fix a mistake, and a retried payout is recorded once', async () => {
    const s = await setup();
    const task = await job(s);
    const ledger = postgresLedger(s.db);
    await ledger.award({ ref: 'earlier', householdId: s.hh, childId: s.child, reason: 'Earlier job', at: s.now(), currency: 'MONEY', amount: 100 });
    const id = await logCompletion(s.db, { childId: s.child, taskId: task.id }, s.now());
    await s.app.inject({ method: 'POST', url: `/api/completions/${id}/approve`, headers: s.headers.mum, payload: { note: null } });
    const award = LedgerLine.array()
      .parse((await s.app.inject({ url: `/api/children/${s.child}/ledger`, headers: s.headers.mum })).json())
      .find((l) => l.reason === 'Emptied the dishwasher')!;
    s.advance(2_000);
    expect((await s.app.inject({ method: 'POST', url: `/api/completions/${id}/undo`, headers: s.headers.mum })).statusCode).toBe(200);
    const again = await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/reverse`, headers: s.headers.mum, payload: { entryRef: award.ref } });
    expect(again.statusCode).toBe(409);
    expect((await ledger.balances(s.hh, s.child)).money).toBe(100);

    const pay = { pence: 40, key: '00000000-0000-4000-8000-0000000000aa' };
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/payouts`, headers: s.headers.mum, payload: pay });
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/payouts`, headers: s.headers.mum, payload: pay });
    expect((await ledger.balances(s.hh, s.child)).money).toBe(60);
  });

  it('keeps the full history to parents', async () => {
    const s = await setup();
    expect((await s.app.inject({ url: `/api/children/${s.child}/ledger`, headers: s.headers.gran })).statusCode).toBe(403);
    expect((await s.app.inject({ url: `/api/children/${s.child}/week`, headers: s.headers.gran })).statusCode).toBe(200);
  });

  it("shows the whole household's ledger on the owner's Ledger screen, to the owner only", async () => {
    const s = await setup();
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/refund-points`, headers: s.headers.mum, payload: { points: 10, reason: 'The Wi-Fi was down', key: crypto.randomUUID() } });
    const res = await s.app.inject({ url: '/api/ledger/entries', headers: s.headers.mum });
    expect(res.statusCode).toBe(200);
    expect(ChainLedger.parse(res.json())).toMatchObject({ adapter: 'postgres', contract: null, queue: null, entries: [{ childName: 'Ollie', kind: 'refund', reason: 'The Wi-Fi was down', change: '+10 points', status: 'recorded', blockNumber: null }] });
    expect((await s.app.inject({ url: '/api/ledger/entries', headers: s.headers.dad })).statusCode).toBe(403);
    expect((await s.app.inject({ url: '/api/ledger/entries', headers: s.headers.gran })).statusCode).toBe(403);
  });

  it('a removed job can be put back', async () => {
    const s = await setup();
    const task = await job(s);
    await s.app.inject({ method: 'DELETE', url: `/api/tasks/${task.id}`, headers: s.headers.mum });
    expect((await s.app.inject({ method: 'POST', url: `/api/tasks/${task.id}/restore`, headers: s.headers.mum })).statusCode).toBe(200);
    expect(Task.array().parse((await s.app.inject({ url: '/api/tasks', headers: s.headers.mum })).json())).toHaveLength(1);
  });
});

describe('money, points and the plan', () => {
  it('pays out only what is owed, and says so', async () => {
    const s = await setup();
    const res = await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/payouts`, headers: s.headers.mum, payload: { pence: 100, key: '00000000-0000-4000-8000-000000000003' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().detail).toMatch(/Not enough pocket money/);
    expect((await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/payouts`, headers: s.headers.gran, payload: { pence: 1, key: '00000000-0000-4000-8000-000000000004' } })).statusCode).toBe(403);
  });

  it('keeps the allowance in 30-minute blocks, and the plan step waits for the tick', async () => {
    const s = await setup();
    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/allowance`, headers: s.headers.mum, payload: { minutes: 400 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/allowance`, headers: s.headers.mum, payload: { minutes: 390 } })).statusCode).toBe(200);
    await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/plan`, headers: s.headers.mum, payload: { stepMinutes: 30, everyWeeks: 4, floorMinutes: 300, nextStepOn: '2026-11-08' } });
    let week = WeekSummary.parse((await s.app.inject({ url: `/api/children/${s.child}/week`, headers: s.headers.mum })).json());
    expect(week.nextStep).toMatchObject({ minutes: 360, on: '2026-11-08', onLabel: 'Sunday 8 November', agreed: false });
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/plan/agree`, headers: s.headers.mum, payload: {} });
    week = WeekSummary.parse((await s.app.inject({ url: `/api/children/${s.child}/week`, headers: s.headers.mum })).json());
    expect(week.nextStep?.agreed).toBe(true);
  });
});

describe('the pilot phase', () => {
  it('switches the economy on, and only the owner changes it', async () => {
    const s = await setup('baseline');
    const task = await job(s);
    await expect(logCompletion(s.db, { childId: s.child, taskId: task.id }, s.now())).rejects.toThrow(/aren't switched on yet/);
    expect((await s.app.inject({ url: '/api/household/pilot', headers: s.headers.gran })).json()).toMatchObject({ phase: 'baseline', features: { economy: false } });
    expect((await s.app.inject({ method: 'PUT', url: '/api/household/pilot', headers: s.headers.dad, payload: { phase: 'reframe' } })).statusCode).toBe(403);
    const res = await s.app.inject({ method: 'PUT', url: '/api/household/pilot', headers: s.headers.mum, payload: { phase: 'reframe' } });
    expect(res.json()).toMatchObject({ phase: 'reframe', features: { economy: true, bonus: false } });
    expect(await logCompletion(s.db, { childId: s.child, taskId: task.id }, s.now())).toMatch(/^[0-9a-f-]{36}$/);
  });
});
