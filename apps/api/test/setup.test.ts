// Settings editors (Phase 9): devices, groups and rules, and schedules are the owner's, audited,
// checked the same way as the command line, and every change wakes the reconciler.
import { auditEvents, schedules, serviceGroupMembers, serviceGroups, services } from '@family-time/db';
import { SetupView } from '@family-time/schemas';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { seedHousehold, seedPerson, signedIn } from './accounts.js';
import { harness, type Harness } from './helpers.js';

const NOW = new Date('2026-10-26T18:32:00Z');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function seed() {
  let woken = 0;
  h = await harness({ now: NOW, notifyChange: async () => void woken++ });
  const db = h.handle.db;
  const home = await seedHousehold(db);
  const mum = await seedPerson(db, home, 'owner', 'Mum');
  const dad = await seedPerson(db, home, 'parent', 'Dad');
  const ollie = await seedPerson(db, home, 'child', 'Ollie');
  const [games] = await db.insert(serviceGroups).values({ householdId: home, name: 'Games' }).returning();
  const [video] = await db.insert(serviceGroups).values({ householdId: home, name: 'Video' }).returning();
  const [roblox] = await db.insert(services).values({ householdId: home, name: 'Roblox', source: 'adguard', adguardId: 'roblox' }).returning();
  await db.insert(serviceGroupMembers).values({ groupId: games!.id, serviceId: roblox!.id });
  const headers = { mum: await signedIn(db, mum), dad: await signedIn(db, dad) };
  return { app: h.app, db, ollie, games: games!, video: video!, roblox: roblox!, headers, woken: () => woken };
}

const view = async (s: Awaited<ReturnType<typeof seed>>) => SetupView.parse((await s.app.inject({ url: '/api/setup', headers: s.headers.mum })).json());

describe('Settings editors', () => {
  it("are the owner's alone", async () => {
    const s = await seed();
    expect((await s.app.inject({ url: '/api/setup', headers: s.headers.dad })).statusCode).toBe(403);
    expect((await s.app.inject({ method: 'POST', url: '/api/setup/devices', headers: s.headers.dad, payload: { label: 'iPad', type: 'ipad', childId: s.ollie, identifiers: ['192.168.1.50'] } })).statusCode).toBe(403);
  });

  it('add, change and remove a device, one address to one device', async () => {
    const s = await seed();
    const add = await s.app.inject({ method: 'POST', url: '/api/setup/devices', headers: s.headers.mum, payload: { label: "Ollie's iPad", type: 'ipad', childId: s.ollie, identifiers: ['192.168.1.50', 'AA:BB:CC:DD:EE:FF'] } });
    expect(add.statusCode).toBe(201);
    expect(s.woken()).toBe(1);
    const { id } = add.json() as { id: string };
    expect((await view(s)).devices).toEqual([{ id, label: "Ollie's iPad", type: 'ipad', childId: s.ollie, identifiers: ['192.168.1.50', 'aa:bb:cc:dd:ee:ff'], sync: 'never' }]);

    const bad = await s.app.inject({ method: 'POST', url: '/api/setup/devices', headers: s.headers.mum, payload: { label: 'Switch', type: 'console', childId: s.ollie, identifiers: ['not an address'] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ detail: `"not an address" doesn't look like an address. Copy it from your router's list, like 192.168.1.50 or a4:83:e7:12:34:56.` });
    // A whole network, a wide range or an impossible address is refused, not passed on to AdGuard.
    for (const wide of ['0.0.0.0/0', '192.168.1.0/16', '999.1.1.1', '192.168.1.300']) {
      const r = await s.app.inject({ method: 'POST', url: '/api/setup/devices', headers: s.headers.mum, payload: { label: 'Wide', type: 'other', childId: s.ollie, identifiers: [wide] } });
      expect(r.statusCode, wide).toBe(400);
    }
    // A /24 that holds another device's address clashes with it.
    const holds = await s.app.inject({ method: 'POST', url: '/api/setup/devices', headers: s.headers.mum, payload: { label: 'Range', type: 'other', childId: s.ollie, identifiers: ['192.168.1.0/24'] } });
    expect(holds.statusCode).toBe(409);
    const twice = await s.app.inject({ method: 'POST', url: '/api/setup/devices', headers: s.headers.mum, payload: { label: 'Switch', type: 'console', childId: s.ollie, identifiers: ['192.168.1.50'] } });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ detail: "Ollie's iPad already uses 192.168.1.50. Each address belongs to one device." });

    expect((await s.app.inject({ method: 'PUT', url: `/api/setup/devices/${id}`, headers: s.headers.mum, payload: { label: 'iPad', type: 'ipad', childId: s.ollie, identifiers: ['192.168.1.51'] } })).statusCode).toBe(200);
    expect((await view(s)).devices[0]).toMatchObject({ label: 'iPad', identifiers: ['192.168.1.51'] });
    expect((await s.app.inject({ method: 'DELETE', url: `/api/setup/devices/${id}`, headers: s.headers.mum })).statusCode).toBe(200);
    expect((await view(s)).devices).toEqual([]);
    // Its address is free again once it is removed.
    expect((await s.app.inject({ method: 'POST', url: '/api/setup/devices', headers: s.headers.mum, payload: { label: 'New iPad', type: 'ipad', childId: s.ollie, identifiers: ['192.168.1.51'] } })).statusCode).toBe(201);
    const actions = (await s.db.select({ action: auditEvents.action }).from(auditEvents)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['device.added', 'device.changed', 'device.removed']));
  });

  it("sets a child's rule for a group, and moves an app between groups", async () => {
    const s = await seed();
    const rule = { childId: s.ollie, groupId: s.games.id, defaultState: 'allowed', allowedDuringWindDown: false, alwaysAllowed: false };
    expect((await s.app.inject({ method: 'PUT', url: '/api/setup/policies', headers: s.headers.mum, payload: rule })).statusCode).toBe(200);
    expect((await s.app.inject({ method: 'PUT', url: '/api/setup/policies', headers: s.headers.mum, payload: { ...rule, defaultState: 'blocked', allowedDuringWindDown: true } })).statusCode).toBe(200);
    expect((await view(s)).policies).toEqual([{ childId: s.ollie, groupId: s.games.id, defaultState: 'blocked', allowedDuringWindDown: true, alwaysAllowed: false }]);

    expect((await s.app.inject({ method: 'PUT', url: `/api/setup/services/${s.roblox.id}/group`, headers: s.headers.mum, payload: { groupId: s.video.id } })).statusCode).toBe(200);
    const v = await view(s);
    expect(v.groups.find((g) => g.name === 'Video')!.services.map((x) => x.name)).toEqual(['Roblox']);
    expect(v.groups.find((g) => g.name === 'Games')!.services).toEqual([]);
    await s.app.inject({ method: 'PUT', url: `/api/setup/services/${s.roblox.id}/group`, headers: s.headers.mum, payload: { groupId: null } });
    expect((await view(s)).ungrouped.map((x) => x.name)).toEqual(['Roblox']);
  });

  it('adds, changes and removes a schedule, one schedule a day and one bedtime', async () => {
    const s = await seed();
    const week = { name: 'School night', childId: null, weekdays: [1, 2, 3, 4], blocks: [{ type: 'school', start: '08:30', end: '15:30' }, { type: 'pause', start: '17:30', end: '18:15', label: 'Tea' }, { type: 'bed', start: '20:30', end: '07:00' }] };
    const add = await s.app.inject({ method: 'POST', url: '/api/setup/schedules', headers: s.headers.mum, payload: week });
    expect(add.statusCode).toBe(201);
    const { id } = add.json() as { id: string };
    const clash = await s.app.inject({ method: 'POST', url: '/api/setup/schedules', headers: s.headers.mum, payload: { ...week, name: 'Thursday', weekdays: [4, 5] } });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ detail: 'School night already covers Thursday. Take Thursday off one of them first.' });
    // A child's own schedule may share days with the household's: it replaces it for them.
    expect((await s.app.inject({ method: 'POST', url: '/api/setup/schedules', headers: s.headers.mum, payload: { ...week, name: "Ollie's Thursday", childId: s.ollie, weekdays: [4] } })).statusCode).toBe(201);
    const twoBeds = await s.app.inject({ method: 'PUT', url: `/api/setup/schedules/${id}`, headers: s.headers.mum, payload: { ...week, blocks: [...week.blocks, { type: 'bed', start: '21:00', end: '07:00' }] } });
    expect(twoBeds.json()).toMatchObject({ detail: 'One bedtime a day is enough. Remove the extra one.' });
    const notTime = await s.app.inject({ method: 'PUT', url: `/api/setup/schedules/${id}`, headers: s.headers.mum, payload: { ...week, blocks: [{ type: 'bed', start: '8.30pm', end: '07:00' }] } });
    expect(notTime.statusCode).toBe(400);

    expect((await s.app.inject({ method: 'PUT', url: `/api/setup/schedules/${id}`, headers: s.headers.mum, payload: { ...week, weekdays: [1, 2, 3], blocks: [{ type: 'bed', start: '20:45', end: '07:00' }] } })).statusCode).toBe(200);
    const [row] = await s.db.select().from(schedules).where(eq(schedules.id, id));
    expect(row).toMatchObject({ weekdays: [1, 2, 3], blocks: [{ type: 'bed', start: '20:45', end: '07:00' }] });
    expect((await s.app.inject({ method: 'DELETE', url: `/api/setup/schedules/${id}`, headers: s.headers.mum })).statusCode).toBe(200);
    expect((await view(s)).schedules.map((x) => x.name)).toEqual(["Ollie's Thursday"]);
  });
});
