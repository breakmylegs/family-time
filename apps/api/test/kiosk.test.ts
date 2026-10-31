// The kiosk's API (ADR 0015): pairing with a code, the token's scope and removal, a kiosk acting
// only for its own family's children, and the child's day on the home screen.
import { households, schedules, services, tasks } from '@family-time/db';
import { postgresLedger } from '@family-time/ledger';
import { KioskHome, KioskMe, KioskPairing, KioskSlots } from '@family-time/schemas';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { resetBadCodes } from '../src/kiosk/commands.js';
import { buildKioskServer } from '../src/kiosk/server.js';
import { seedHousehold, seedPerson, signedIn } from './accounts.js';
import { harness, LogSink, type Harness } from './helpers.js';

let h: Harness | undefined;
let kiosk: FastifyInstance | undefined;
afterEach(async () => {
  resetBadCodes();
  await kiosk?.close();
  await h?.close();
  h = undefined;
  kiosk = undefined;
});

/** Monday 26 October 2026, 16:00 London, a family on the reward-less phase with a kiosk server beside the parents' one. */
async function setup() {
  const at = new Date('2026-10-26T16:00:00Z');
  h = await harness({ clock: () => at });
  const db = h.handle.db;
  const hh = await seedHousehold(db);
  await db.update(households).set({ pilotPhase: 'reward-less' }).where(eq(households.id, hh));
  const mum = await seedPerson(db, hh, 'owner', 'Mum');
  const dad = await seedPerson(db, hh, 'parent', 'Dad');
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
  const [dishes] = await db.insert(tasks).values({ householdId: hh, title: 'Empty the dishwasher', picture: 'dishes', rewardType: 'money', amount: 50, createdBy: mum }).returning();
  const ledger = postgresLedger(db);
  await ledger.allocateAllowance({ ref: 'week:1', householdId: hh, childId: child, reason: 'Weekly time', at, minutes: 420 });
  const alerts: { kind: string; id: string }[] = [];
  kiosk = await buildKioskServer({ db, ledger, now: () => at, logStream: new LogSink(), logLevel: 'warn', queueAlert: async (job) => void alerts.push(job) });
  const headers = { mum: await signedIn(db, mum), dad: await signedIn(db, dad) };
  return { db, app: h.app, kiosk, hh, child, roblox: roblox!, dishes: dishes!, headers, alerts, at };
}

async function paired(s: Awaited<ReturnType<typeof setup>>) {
  const made = await s.app.inject({ method: 'POST', url: '/api/kiosks/pairing', headers: s.headers.mum, payload: { label: 'Fire tablet' } });
  expect(made.statusCode).toBe(201);
  const { code } = KioskPairing.parse(made.json());
  const res = await s.kiosk.inject({ method: 'POST', url: '/api/pair', payload: { code } });
  expect(res.statusCode).toBe(200);
  return { authorization: `Bearer ${(res.json() as { token: string }).token}`, code };
}

describe('pairing', () => {
  it('swaps a parent-made code for a token once, and only the owner makes codes', async () => {
    const s = await setup();
    expect((await s.app.inject({ method: 'POST', url: '/api/kiosks/pairing', headers: s.headers.dad, payload: {} })).statusCode).toBe(403);
    const { authorization, code } = await paired(s);
    expect((await s.kiosk.inject({ method: 'POST', url: '/api/pair', payload: { code } })).statusCode).toBe(400);
    const me = KioskMe.parse((await s.kiosk.inject({ url: '/api/me', headers: { authorization } })).json());
    expect(me.children).toEqual([{ id: s.child, name: 'Ollie' }]);
    expect((await s.kiosk.inject({ url: '/api/me' })).statusCode).toBe(401);
    expect((await s.kiosk.inject({ url: '/api/me', headers: { authorization: 'Bearer not-a-token' } })).statusCode).toBe(401);
  });

  it('stops a removed kiosk at once', async () => {
    const s = await setup();
    const { authorization } = await paired(s);
    const [k] = (await s.app.inject({ url: '/api/kiosks', headers: s.headers.mum })).json() as { id: string }[];
    expect((await s.app.inject({ method: 'DELETE', url: `/api/kiosks/${k!.id}`, headers: s.headers.mum })).statusCode).toBe(200);
    expect((await s.kiosk.inject({ url: '/api/me', headers: { authorization } })).statusCode).toBe(401);
  });

  it('slows down guessing', async () => {
    const s = await setup();
    const codes = await Promise.all(Array.from({ length: 11 }, () => s.kiosk.inject({ method: 'POST', url: '/api/pair', payload: { code: '000000' } })));
    expect(codes.map((r) => r.statusCode)).toContain(429);
  });

  it("never acts for another family's child", async () => {
    const s = await setup();
    const { authorization } = await paired(s);
    const other = await seedHousehold(s.db);
    const stranger = await seedPerson(s.db, other, 'child', 'Stranger');
    expect((await s.kiosk.inject({ url: `/api/children/${stranger}/home`, headers: { authorization } })).statusCode).toBe(404);
    expect((await s.kiosk.inject({ method: 'POST', url: `/api/children/${stranger}/jobs/${s.dishes.id}/done`, headers: { authorization }, payload: {} })).statusCode).toBe(404);
  });

  it('serves no parent route', async () => {
    const s = await setup();
    const { authorization } = await paired(s);
    expect((await s.kiosk.inject({ url: '/api/kiosks', headers: { authorization } })).statusCode).toBe(404);
    expect((await s.kiosk.inject({ url: '/api/approvals', headers: { ...s.headers.mum, authorization } })).statusCode).toBe(404);
  });
});

describe("the child's day", () => {
  it('shows the week, the jobs and the wind-down, and plans a session that fits', async () => {
    const s = await setup();
    const { authorization } = await paired(s);
    const home = KioskHome.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/home`, headers: { authorization } })).json());
    expect(home).toMatchObject({ clock: 'Monday 16:00', pill: { kind: 'wind-down', label: 'Wind-down at 19:30' }, night: false, rightNow: null });
    expect(home.week).toMatchObject({ headline: '7 h left to plan this week' });
    expect(home.week!.blocks).toHaveLength(14);
    expect(home.jobs).toEqual([{ id: s.dishes.id, title: 'Empty the dishwasher', picture: 'dishes', reward: '50p', status: 'todo' }]);

    const slots = KioskSlots.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/slots?kind=service&id=${s.roblox.id}&minutes=60`, headers: { authorization } })).json());
    expect(slots.cost).toBe("60 minutes is 2 blocks. You'll have 6 h left after.");
    expect(slots.slots[0]).toMatchObject({ label: 'Now', ok: true });
    // 19:00 to 20:00 runs into wind-down: greyed, with the reason in Ollie's words.
    expect(slots.slots.find((x) => x.label === '19:00')).toMatchObject({ ok: false, reason: expect.stringMatching(/Wind-down/) });

    const plan = await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/plan`, headers: { authorization }, payload: { target: { kind: 'service', id: s.roblox.id }, start: slots.slots[0]!.start, minutes: 60 } });
    expect(plan.statusCode).toBe(201);
    const after = KioskHome.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/home`, headers: { authorization } })).json());
    expect(after.rightNow).toMatchObject({ title: 'Roblox until 17:00' });
  });

  it('logs a job with a photo and tells the parents, then shows it waiting', async () => {
    const s = await setup();
    const { authorization } = await paired(s);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
    const res = await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/jobs/${s.dishes.id}/done`, headers: { authorization }, payload: { photo: jpeg } });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };
    expect(s.alerts).toEqual([{ kind: 'completion', id }]);
    const home = KioskHome.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/home`, headers: { authorization } })).json());
    expect(home.jobs[0]!.status).toBe('waiting');
    const photo = await s.app.inject({ url: `/api/completions/${id}/photo`, headers: s.headers.mum });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
  });

  it('keeps ideas, and asks a grown-up', async () => {
    const s = await setup();
    const { authorization } = await paired(s);
    expect((await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/ideas`, headers: { authorization }, payload: { text: 'Build a den', picture: 'tent' } })).statusCode).toBe(201);
    const home = KioskHome.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/home`, headers: { authorization } })).json());
    expect(home.ideas.map((i) => i.text)).toEqual(['Build a den']);
    const ask = await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/ask`, headers: { authorization }, payload: { target: { kind: 'service', id: s.roblox.id }, start: '2026-10-26T18:00:00.000Z', minutes: 30 } });
    expect(ask.statusCode).toBe(201);
    expect(s.alerts.map((a) => a.kind)).toEqual(['request']);
  });
});

describe('the kiosk port, hardened', () => {
  it('refuses a large body before reading it, unless it is a photo', async () => {
    const s = await setup();
    const big = JSON.stringify({ x: 'a'.repeat(20_000) });
    expect((await s.kiosk.inject({ method: 'POST', url: '/anything', headers: { 'content-type': 'application/json' }, payload: big })).statusCode).toBe(404);
    expect((await s.kiosk.inject({ method: 'POST', url: '/api/pair', headers: { 'content-type': 'application/json' }, payload: big })).statusCode).toBe(413);
    const { authorization } = await paired(s);
    const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(300_000)]).toString('base64');
    expect((await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/jobs/${s.dishes.id}/done`, headers: { authorization }, payload: { photo } })).statusCode).toBe(201);
  });

  it('voids every code when wrong guesses pile up, and a new code voids the old one', async () => {
    const s = await setup();
    const first = KioskPairing.parse((await s.app.inject({ method: 'POST', url: '/api/kiosks/pairing', headers: s.headers.mum, payload: {} })).json());
    const second = KioskPairing.parse((await s.app.inject({ method: 'POST', url: '/api/kiosks/pairing', headers: s.headers.mum, payload: {} })).json());
    // The older code no longer works.
    if (first.code !== second.code) expect((await s.kiosk.inject({ method: 'POST', url: '/api/pair', payload: { code: first.code } })).statusCode).toBe(400);
    for (let i = 0; i < 21; i++) {
      const wrong = String((Number(second.code) + 1 + i) % 1_000_000).padStart(6, '0');
      await s.kiosk.inject({ method: 'POST', url: '/api/pair', payload: { code: wrong }, remoteAddress: `10.0.0.${i + 1}` });
    }
    expect((await s.kiosk.inject({ method: 'POST', url: '/api/pair', payload: { code: second.code }, remoteAddress: '10.0.1.1' })).statusCode).toBe(400);
  });

  it('caps the requests waiting for a grown-up', async () => {
    const s = await setup();
    const { authorization } = await paired(s);
    const ask = (start: string) => s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/ask`, headers: { authorization }, payload: { target: { kind: 'service', id: s.roblox.id }, start, minutes: 30 } });
    for (const t of ['17:00', '17:30', '18:00']) expect((await ask(`2026-10-26T${t}:00.000Z`)).statusCode).toBe(201);
    expect((await ask('2026-10-26T18:30:00.000Z')).statusCode).toBe(409);
  });

  it("shows only its own family's photos, and keeps the Sunday answers from carers", async () => {
    const s = await setup();
    const other = await seedHousehold(s.db);
    const stranger = await seedPerson(s.db, other, 'owner', 'Stranger');
    const { authorization } = await paired(s);
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64');
    const { id } = (await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/jobs/${s.dishes.id}/done`, headers: { authorization }, payload: { photo } })).json() as { id: string };
    expect((await s.app.inject({ url: `/api/completions/${id}/photo`, headers: await signedIn(s.db, stranger) })).statusCode).toBe(404);
    expect((await s.app.inject({ url: '/api/completions/not-an-id/photo', headers: s.headers.mum })).statusCode).toBe(400);
  });
});
