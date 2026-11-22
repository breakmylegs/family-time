import { AdGuard, BEGIN, BYPASS_RULES, END, SETTING_ADGUARD_SCOPE } from '@family-time/adguard-client';
import { FakeAdGuard } from '@family-time/adguard-client/fake';
import { adguardSync, devices, overrides, settings } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOT_CONFIRMED_AFTER, reconcile, SETTING_BYPASS_RULES } from '../src/reconcile.js';
import { jsonLog } from '../src/worker.js';
import { FREE_TIME, seedHome } from './seed.js';

let handle: TestDb;
let fake: FakeAdGuard;
let adguard: AdGuard;
const log = jsonLog('worker', 'error', () => undefined);

beforeEach(async () => {
  handle = await testDb();
  fake = new FakeAdGuard();
  adguard = new AdGuard({ baseUrl: await fake.start(), username: fake.username, password: fake.password });
});
afterEach(async () => {
  await fake.stop();
  await handle.close();
});

const run = (at = FREE_TIME) => reconcile({ db: handle.db, adguard, now: () => at, log });
const client = () => fake.clients.find((c) => c.name === 'ft-ollieipad');
const sync = async (deviceId: string) => (await handle.db.select().from(adguardSync).where(eq(adguardSync.deviceId, deviceId)))[0];

describe('reconcile', () => {
  it('creates the device client and blocks everything not allowed, then confirms', async () => {
    const s = await seedHome(handle.db);
    const result = await run();
    expect(result).toEqual({ devices: 1, confirmed: 1, failed: 0 });
    expect(client()).toMatchObject({ ids: ['192.168.1.50'], use_global_blocked_services: false, blocked_services: ['roblox', 'youtube'] });
    expect(fake.userRules).toEqual([BEGIN, "||minecraft.net^$client='ft-ollieipad'", "||mojang.com^$client='ft-ollieipad'", END]);
    expect(await sync(s.ipad.id)).toMatchObject({ state: 'confirmed', failures: 0 });
  });

  it('unblocks a group a parent allowed, built-in and custom alike', async () => {
    const s = await seedHome(handle.db);
    await run();
    await handle.db.insert(overrides).values({
      householdId: s.hh.id,
      childId: s.ollie.id,
      targetKind: 'group',
      targetId: s.games.id,
      type: 'allow',
      startsAt: new Date(FREE_TIME.getTime() - 60_000),
      endsAt: new Date(FREE_TIME.getTime() + 30 * 60_000),
      createdBy: s.mum.id,
    });
    await run();
    expect(client()?.blocked_services).toEqual(['youtube']);
    expect(fake.userRules).toEqual([BEGIN, END]);
    // And it expires back to normal on its own.
    await run(new Date(FREE_TIME.getTime() + 31 * 60_000));
    expect(client()?.blocked_services).toEqual(['roblox', 'youtube']);
  });

  it('puts the bypass rules at the top of its block once the owner has switched them on', async () => {
    const s = await seedHome(handle.db);
    await handle.db.insert(settings).values({ householdId: s.hh.id, key: SETTING_BYPASS_RULES, value: true });
    await run();
    expect(fake.userRules.slice(0, 1 + BYPASS_RULES.length)).toEqual([BEGIN, ...BYPASS_RULES]);
    expect(fake.userRules).toContain("||minecraft.net^$client='ft-ollieipad'");
  });

  it("takes away the client of a device removed in Settings, and never anyone else's", async () => {
    const s = await seedHome(handle.db);
    await run();
    fake.clients.push({ name: 'living-room-tv', ids: ['192.168.1.60'] });
    await handle.db.update(devices).set({ removedAt: FREE_TIME }).where(eq(devices.id, s.ipad.id));
    expect(await run()).toEqual({ devices: 0, confirmed: 0, failed: 0 });
    expect(client()).toBeUndefined();
    expect(fake.clients.map((c) => c.name)).toEqual(['living-room-tv']);
    expect(fake.userRules).toEqual([BEGIN, END]);
  });

  it('writes nothing when nothing changed', async () => {
    await seedHome(handle.db);
    await run();
    fake.writes = [];
    await run();
    expect(fake.writes).toEqual([]);
  });

  it('keeps every field of the client it does not own, and every rule outside its markers', async () => {
    await seedHome(handle.db);
    fake.clients.push({ name: 'ft-ollieipad', ids: ['192.168.1.50'], upstreams: ['9.9.9.9'], tags: ['device_tablet'], safesearch_enabled: true });
    fake.userRules = ['||ads.example^', '@@||bank.example^'];
    await run();
    expect(client()).toMatchObject({ upstreams: ['9.9.9.9'], tags: ['device_tablet'], safesearch_enabled: true });
    expect(fake.userRules.slice(0, 2)).toEqual(['||ads.example^', '@@||bank.example^']);
  });

  it('counts failed confirmations and shows Not confirmed after three in a row, then recovers', async () => {
    const s = await seedHome(handle.db);
    await run();
    fake.faults.dropUpdates = true;
    await handle.db.insert(overrides).values({
      householdId: s.hh.id,
      childId: s.ollie.id,
      targetKind: 'everything',
      type: 'allow',
      startsAt: FREE_TIME,
      endsAt: new Date(FREE_TIME.getTime() + 3_600_000),
      createdBy: s.mum.id,
    });
    for (let i = 1; i <= NOT_CONFIRMED_AFTER; i++) {
      const r = await run(new Date(FREE_TIME.getTime() + i * 60_000));
      expect(r.failed).toBe(1);
      // Reported once, on the run that reaches Not confirmed, so parents get one alert.
      expect(r.notConfirmed).toEqual(i === NOT_CONFIRMED_AFTER ? [s.ipad.id] : undefined);
      expect(await sync(s.ipad.id)).toMatchObject({ failures: i, state: i < NOT_CONFIRMED_AFTER ? 'pending' : 'not-confirmed', lastError: 'AdGuard does not hold what was written' });
    }
    fake.faults.dropUpdates = false;
    await run(new Date(FREE_TIME.getTime() + 5 * 60_000));
    expect(await sync(s.ipad.id)).toMatchObject({ state: 'confirmed', failures: 0 });
  });

  it('records an error, not a crash, when AdGuard is down', async () => {
    const s = await seedHome(handle.db);
    await fake.stop();
    const r = await run();
    expect(r.failed).toBe(1);
    expect((await sync(s.ipad.id))?.lastError).toMatch(/could not be reached/);
  });

  it('refuses to touch the rules when someone broke our markers, and says so', async () => {
    const s = await seedHome(handle.db);
    fake.userRules = [BEGIN, '||something^', BEGIN, END];
    const before = [...fake.userRules];
    const r = await run();
    expect(fake.userRules).toEqual(before);
    expect(r.rulesError).toMatch(/2 family-time begin marker/);
    // Built-in blocking still went through, but the device is not confirmed: Minecraft is not blocked.
    expect(client()?.blocked_services).toEqual(['roblox', 'youtube']);
    expect((await sync(s.ipad.id))?.state).toBe('pending');
  });

  it("on an AdGuard someone else manages, writes only between markers the owner added, never adding them", async () => {
    const s = await seedHome(handle.db);
    await handle.db.insert(settings).values({ householdId: s.hh.id, key: SETTING_ADGUARD_SCOPE, value: 'family-time-only' });
    // Switched on by an earlier full setup: network-wide, so left out in this mode.
    await handle.db.insert(settings).values({ householdId: s.hh.id, key: SETTING_BYPASS_RULES, value: true });
    fake.userRules = ['||theirs.example^'];
    const r = await run();
    expect(fake.userRules).toEqual(['||theirs.example^']);
    expect(r.rulesError).toMatch(/no family-time markers/);
    expect(r.rulesError).toMatch(/Custom filtering rules/);
    // Once the owner adds them, our rules go between them and theirs stay where they were.
    fake.userRules = [BEGIN, END, '||theirs.example^'];
    await run();
    expect(fake.userRules).toEqual([BEGIN, "||minecraft.net^$client='ft-ollieipad'", "||mojang.com^$client='ft-ollieipad'", END, '||theirs.example^']);
  });
});
