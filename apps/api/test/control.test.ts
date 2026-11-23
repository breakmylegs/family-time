import { auditEvents, devices, households, overrides, people, policies, schedules, serviceGroupMembers, serviceGroups, services, type Db } from '@family-time/db';
import { ChildStatus } from '@family-time/schemas';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { ORIGIN, seedHousehold, seedPerson, signedIn } from './accounts.js';
import { harness, type Harness } from './helpers.js';

// Monday 26 October 2026, 16:00 London: free time on a school night.
const FREE = new Date('2026-10-26T16:00:00Z');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function seed(db: Db) {
  const hh = await seedHousehold(db);
  const owner = await seedPerson(db, hh, 'owner', 'Mum');
  const carer = await seedPerson(db, hh, 'carer', 'Gran');
  const child = await seedPerson(db, hh, 'child', 'Ollie');
  const [youtube] = await db.insert(services).values({ householdId: hh, name: 'YouTube', source: 'adguard', adguardId: 'youtube', domains: ['youtube.com'] }).returning();
  const [roblox] = await db.insert(services).values({ householdId: hh, name: 'Roblox', source: 'adguard', adguardId: 'roblox', domains: ['roblox.com'] }).returning();
  const [games] = await db.insert(serviceGroups).values({ householdId: hh, name: 'Games' }).returning();
  await db.insert(serviceGroupMembers).values({ groupId: games!.id, serviceId: roblox!.id });
  await db.insert(policies).values({ childId: child, groupId: games!.id });
  await db.insert(schedules).values({
    householdId: hh,
    name: 'School night',
    weekdays: [1, 2, 3, 4, 5],
    blocks: [
      { type: 'school', start: '08:30', end: '15:30' },
      { type: 'bed', start: '20:30', end: '07:00' },
    ],
  });
  const [ipad] = await db.insert(devices).values({ householdId: hh, childId: child, label: "Ollie's iPad", type: 'ipad', adguardName: 'ft-ipad', identifiers: ['192.168.1.50'] }).returning();
  return { hh, owner, carer, child, youtube: youtube!, roblox: roblox!, games: games!, ipad: ipad! };
}

describe('control', () => {
  it('shows each service with its plain-English reason', async () => {
    h = await harness({ now: FREE });
    const s = await seed(h.handle.db);
    const res = await h.app.inject({ url: `/api/children/${s.child}/status`, headers: await signedIn(h.handle.db, s.owner) });
    const status = ChildStatus.parse(res.json());
    expect(status.services.map((x) => [x.name, x.state, x.reason])).toEqual([
      ['Roblox', 'blocked', 'Not planned today. Usual school night rule.'],
      ['YouTube', 'blocked', 'Not planned today. Usual school night rule.'],
    ]);
    expect(status.devices).toEqual([expect.objectContaining({ label: "Ollie's iPad", sync: 'never' })]);
    expect(status.services.every((x) => x.inForce === false)).toBe(true);
  });

  it('allows Roblox for 30 minutes, says who and until when, audits it, and wakes the reconciler', async () => {
    let nudges = 0;
    h = await harness({ now: FREE, notifyChange: async () => void nudges++ });
    const s = await seed(h.handle.db);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/children/${s.child}/overrides`,
      headers: await signedIn(h.handle.db, s.owner),
      payload: { target: { kind: 'service', id: s.roblox.id }, type: 'allow', duration: '30m' },
    });
    expect(res.statusCode).toBe(201);
    const roblox = ChildStatus.parse(res.json()).services.find((x) => x.name === 'Roblox')!;
    expect(roblox).toMatchObject({ state: 'allowed', reason: 'Mum allowed it.', until: '2026-10-26T16:30:00.000Z' });
    expect(nudges).toBe(1);
    const [o] = await h.handle.db.select().from(overrides);
    expect(o).toMatchObject({ countsAgainstAllowance: true, overridesBedtime: false });
    const events = await h.handle.db.select().from(auditEvents).where(eq(auditEvents.action, 'control.allow'));
    expect(events).toHaveLength(1);
  });

  it('runs Until tomorrow through bedtime only because the parent picked it', async () => {
    h = await harness({ now: FREE });
    const s = await seed(h.handle.db);
    await h.app.inject({
      method: 'POST',
      url: `/api/children/${s.child}/overrides`,
      headers: await signedIn(h.handle.db, s.owner),
      payload: { target: { kind: 'group', id: s.games.id }, type: 'allow', duration: 'until-tomorrow', countsAgainstAllowance: false },
    });
    const [o] = await h.handle.db.select().from(overrides);
    expect(o).toMatchObject({ overridesBedtime: true, countsAgainstAllowance: false });
    expect(o!.endsAt?.toISOString()).toBe('2026-10-27T07:00:00.000Z');
  });

  it('refuses an Allow that never ends', async () => {
    h = await harness({ now: FREE });
    const s = await seed(h.handle.db);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/children/${s.child}/overrides`,
      headers: await signedIn(h.handle.db, s.owner),
      payload: { target: { kind: 'everything' }, type: 'allow', duration: 'until-resume' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toMatch(/Only Pause/);
  });

  it('lets a carer pause and resume, but not allow', async () => {
    h = await harness({ now: FREE });
    const s = await seed(h.handle.db);
    const headers = await signedIn(h.handle.db, s.carer);
    const allow = await h.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers, payload: { target: { kind: 'everything' }, type: 'allow', duration: '1h' } });
    expect(allow.statusCode).toBe(403);
    const pause = await h.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers, payload: { target: { kind: 'everything' }, type: 'pause', duration: 'until-resume' } });
    expect(ChildStatus.parse(pause.json()).services.every((x) => x.state === 'paused' && x.reason === 'Paused by Gran until someone resumes it.')).toBe(true);
    const resume = await h.app.inject({ method: 'POST', url: `/api/children/${s.child}/resume`, headers });
    expect(ChildStatus.parse(resume.json()).services.every((x) => x.state === 'blocked')).toBe(true);
  });

  it('goes back to Normal by ending the live overrides for that target only', async () => {
    h = await harness({ now: FREE });
    const s = await seed(h.handle.db);
    const headers = await signedIn(h.handle.db, s.owner);
    const post = (payload: Record<string, unknown>) => h!.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers, payload });
    await post({ target: { kind: 'service', id: s.roblox.id }, type: 'allow', duration: '1h' });
    await post({ target: { kind: 'service', id: s.youtube.id }, type: 'allow', duration: '1h' });
    const res = await h.app.inject({ method: 'POST', url: `/api/children/${s.child}/normal`, headers, payload: { target: { kind: 'service', id: s.roblox.id } } });
    const status = ChildStatus.parse(res.json());
    expect(status.services.find((x) => x.name === 'Roblox')?.state).toBe('blocked');
    expect(status.services.find((x) => x.name === 'YouTube')?.state).toBe('allowed');
  });

  it("refuses another family's child or service", async () => {
    h = await harness({ now: FREE });
    const s = await seed(h.handle.db);
    const headers = await signedIn(h.handle.db, s.owner);
    const [otherHome] = await h.handle.db.insert(households).values({ name: 'Other' }).returning();
    const other = await h.handle.db.insert(people).values({ householdId: otherHome!.id, displayName: 'Stranger', role: 'child' }).returning();
    expect((await h.app.inject({ url: `/api/children/${other[0]!.id}/status`, headers })).statusCode).toBe(404);
    const bad = await h.app.inject({
      method: 'POST',
      url: `/api/children/${s.child}/overrides`,
      headers,
      payload: { target: { kind: 'service', id: '00000000-0000-4000-8000-000000000000' }, type: 'block', duration: '30m' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toMatch(/no longer on your family's list/);
  });

  it('lists the domains a device asked for in the last 30 minutes, owner only', async () => {
    const t = (min: number) => new Date(FREE.getTime() - min * 60_000).toISOString();
    const asked: (string | undefined)[] = [];
    h = await harness({
      now: FREE,
      // The worker answers for one device: the api asks with that device's id (ADR 0022).
      readQuerylog: async (_limit, deviceId) => (asked.push(deviceId), [
        { time: t(1), client: '192.168.1.50', client_info: { name: 'ft-ipad' }, question: { name: 'cdn.newgame.example' } },
        { time: t(2), client: '192.168.1.50', client_info: { name: 'ft-ipad' }, question: { name: 'cdn.newgame.example' } },
        { time: t(3), client: '192.168.1.50', client_info: { name: 'ft-ipad' }, question: { name: 'www.roblox.com' } },
        { time: t(45), client: '192.168.1.50', client_info: { name: 'ft-ipad' }, question: { name: 'old.example' } },
        { time: t(1), client: '192.168.1.77', client_info: { name: 'someone-else' }, question: { name: 'not-ours.example' } },
      ]),
    });
    const s = await seed(h.handle.db);
    const res = await h.app.inject({ url: `/api/devices/${s.ipad.id}/discovery`, headers: await signedIn(h.handle.db, s.owner) });
    expect(res.json()).toEqual([
      { domain: 'cdn.newgame.example', queries: 2, service: null },
      { domain: 'www.roblox.com', queries: 1, service: 'Roblox' },
    ]);
    expect(asked).toEqual([s.ipad.id]);
    const parent = await seedPerson(h.handle.db, s.hh, 'parent', 'Dad');
    expect((await h.app.inject({ url: `/api/devices/${s.ipad.id}/discovery`, headers: await signedIn(h.handle.db, parent) })).statusCode).toBe(403);
  });

  it("says so when the worker can't read AdGuard for the discovery helper", async () => {
    h = await harness({ now: FREE, readQuerylog: async () => Promise.reject(new Error("The worker didn't answer in time. Check AdGuard is reachable, then try again.")) });
    const s = await seed(h.handle.db);
    const res = await h.app.inject({ url: `/api/devices/${s.ipad.id}/discovery`, headers: await signedIn(h.handle.db, s.owner) });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'adguard_unreachable', detail: expect.stringMatching(/didn't answer in time/) });
  });

  it('needs the right Origin like every other change', async () => {
    h = await harness({ now: FREE });
    const s = await seed(h.handle.db);
    const headers = { ...(await signedIn(h.handle.db, s.owner)), origin: 'https://evil.example' };
    const res = await h.app.inject({ method: 'POST', url: `/api/children/${s.child}/resume`, headers });
    expect(res.statusCode).toBe(403);
    expect(ORIGIN).not.toBe('https://evil.example');
  });
});
