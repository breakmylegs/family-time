// The whole family (Phase 9, the transitions phase): stopping points, the parents' own screen time,
// and the family challenge, through the parents' api and the kiosk.
import { households, schedules, services } from '@family-time/db';
import { postgresLedger } from '@family-time/ledger';
import { KioskHome, KioskPairing, WholeFamily } from '@family-time/schemas';
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

/** Monday 26 October 2026, 16:00 London, with a kiosk paired. */
async function setup(phase: string) {
  const clock = { at: new Date('2026-10-26T16:00:00Z') };
  h = await harness({ clock: () => clock.at });
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
  kiosk = await buildKioskServer({ db, ledger: postgresLedger(db), now: () => clock.at, logStream: new LogSink(), logLevel: 'warn' });
  const headers = { mum: await signedIn(db, mum), dad: await signedIn(db, dad), gran: await signedIn(db, gran) };
  const made = await h.app.inject({ method: 'POST', url: '/api/kiosks/pairing', headers: headers.mum, payload: { label: 'Tablet' } });
  const { code } = KioskPairing.parse(made.json());
  const token = (await kiosk.inject({ method: 'POST', url: '/api/pair', payload: { code } })).json() as { token: string };
  return { app: h.app, kiosk, clock, child, roblox: roblox!, headers, device: { authorization: `Bearer ${token.token}` } };
}

describe('the whole family', () => {
  it('stays out of the way before the transitions phase', async () => {
    const s = await setup('reward-less');
    const whole = WholeFamily.parse((await s.app.inject({ url: '/api/family/whole', headers: s.headers.mum })).json());
    expect(whole.on).toBe(false);
    const home = KioskHome.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/home`, headers: s.device })).json());
    expect(home.family).toBeNull();
  });

  it("puts the parents' own screen time beside the challenge, ticked by anyone up to the target", async () => {
    const s = await setup('transitions');
    expect((await s.app.inject({ method: 'PUT', url: '/api/family/my-screen-time', headers: s.headers.dad, payload: { minutes: 240 } })).statusCode).toBe(200);
    expect((await s.app.inject({ method: 'PUT', url: '/api/family/my-screen-time', headers: s.headers.mum, payload: { minutes: 120 } })).statusCode).toBe(200);
    // Grandparents are not asked about their own screens, and do not set the challenge.
    expect((await s.app.inject({ method: 'PUT', url: '/api/family/my-screen-time', headers: s.headers.gran, payload: { minutes: 60 } })).statusCode).toBe(403);
    expect((await s.app.inject({ method: 'PUT', url: '/api/family/challenge', headers: s.headers.gran, payload: { title: 'Screen-free tea', target: 2 } })).statusCode).toBe(403);
    expect((await s.app.inject({ method: 'POST', url: '/api/family/challenge/tick', headers: s.headers.gran })).statusCode).toBe(404);

    expect((await s.app.inject({ method: 'PUT', url: '/api/family/challenge', headers: s.headers.mum, payload: { title: 'Screen-free tea', target: 2 } })).statusCode).toBe(200);
    expect((await s.app.inject({ method: 'POST', url: '/api/family/challenge/tick', headers: s.headers.gran })).statusCode).toBe(200);
    const ticked = await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/challenge/tick`, headers: s.device });
    expect(ticked.json()).toEqual({ title: 'Screen-free tea', target: 2, done: 2 });
    // Past the target it is already done: nothing more is added.
    expect((await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/challenge/tick`, headers: s.device })).json()).toMatchObject({ done: 2 });

    const whole = WholeFamily.parse((await s.app.inject({ url: '/api/family/whole', headers: s.headers.dad })).json());
    expect(whole.on).toBe(true);
    expect(whole.parents.map((p) => [p.name, p.me, p.weeks[0]!.minutes])).toEqual([
      ['Dad', true, 240],
      ['Mum', false, 120],
    ]);
    expect(whole.parents[0]!.weeks).toHaveLength(4);
    expect(whole.parents[0]!.weeks[0]!.label).toBe('This week');
    expect(whole.challenge).toMatchObject({ title: 'Screen-free tea', target: 2, done: 2 });
    expect(whole.challenge!.ticks.map((t) => t.by)).toEqual(expect.arrayContaining(['Gran', 'Ollie']));

    const home = KioskHome.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/home`, headers: s.device })).json());
    expect(home.family).toEqual({ challenge: { title: 'Screen-free tea', target: 2, done: 2 }, grownUps: "Mum and Dad's screen time this week: 6 h" });

    // A new challenge replaces the old one; ending it leaves none.
    await s.app.inject({ method: 'PUT', url: '/api/family/challenge', headers: s.headers.dad, payload: { title: 'Board game night', target: 1 } });
    expect(WholeFamily.parse((await s.app.inject({ url: '/api/family/whole', headers: s.headers.mum })).json()).challenge).toMatchObject({ title: 'Board game night', done: 0 });
    await s.app.inject({ method: 'DELETE', url: '/api/family/challenge', headers: s.headers.dad });
    expect(WholeFamily.parse((await s.app.inject({ url: '/api/family/whole', headers: s.headers.mum })).json()).challenge).toBeNull();
  });

  it('gives an Allow that ends on its own a few minutes to find a stopping point, and a parent can change how many', async () => {
    const s = await setup('transitions');
    expect(WholeFamily.parse((await s.app.inject({ url: '/api/family/whole', headers: s.headers.mum })).json()).stoppingPointMinutes).toBe(5);
    expect((await s.app.inject({ method: 'PUT', url: '/api/family/stopping-point', headers: s.headers.dad, payload: { minutes: 16 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'PUT', url: '/api/family/stopping-point', headers: s.headers.dad, payload: { minutes: 10 } })).statusCode).toBe(200);

    const allow = await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers: s.headers.mum, payload: { target: { kind: 'service', id: s.roblox.id }, type: 'allow', duration: '30m' } });
    expect(allow.statusCode).toBe(201);
    s.clock.at = new Date('2026-10-26T16:33:00Z');
    const home = KioskHome.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/home`, headers: s.device })).json());
    expect(home.rightNow).toEqual({ title: 'Finishing up', detail: 'Find a good place to stop, like the end of a level, by about 16:40.', icon: null, used: null });
    s.clock.at = new Date('2026-10-26T16:41:00Z');
    expect(KioskHome.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/home`, headers: s.device })).json()).rightNow).toBeNull();
  });
});
