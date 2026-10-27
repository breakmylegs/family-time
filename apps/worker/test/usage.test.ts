import { AdGuard } from '@family-time/adguard-client';
import { FakeAdGuard } from '@family-time/adguard-client/fake';
import { devices, usageMinutes } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { estimateMinutes, markQuiet, readUsage, ruleDomain, serviceFor } from '../src/usage.js';
import { jsonLog } from '../src/worker.js';
import { BEDTIME, FREE_TIME, seedHome } from './seed.js';

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

const minute = (m: number, s = 0) => new Date(FREE_TIME.getTime() + m * 60_000 + s * 1000);

describe('reading usage', () => {
  it('counts queries per device, service and minute, and keeps nothing else', async () => {
    const s = await seedHome(handle.db);
    for (const sec of [1, 10, 20, 30]) fake.logQuery(minute(1, sec), 'ft-ollieipad', 'r1.googlevideo.com');
    fake.logQuery(minute(1, 40), 'ft-ollieipad', 'www.roblox.com');
    fake.logQuery(minute(2, 5), 'ft-ollieipad', 'i.ytimg.com');
    fake.logQuery(minute(2, 6), 'ft-ollieipad', 'news.bbc.co.uk'); // not a managed service
    fake.logQuery(minute(2, 7), 'someone-else', 'youtube.com', '192.168.1.99'); // not our device
    const r = await readUsage({ db: handle.db, adguard, now: () => minute(3), log });
    expect(r.read).toBe(8);
    const rows = await handle.db.select().from(usageMinutes);
    const view = rows.map((x) => [x.serviceId === s.youtube.id ? 'youtube' : 'roblox', x.minute.toISOString(), x.queries]).sort();
    expect(view).toEqual(
      [
        ['roblox', minute(1).toISOString(), 1],
        ['youtube', minute(1).toISOString(), 4],
        ['youtube', minute(2).toISOString(), 1],
      ].sort(),
    );
    const [ipad] = await handle.db.select().from(devices).where(eq(devices.id, s.ipad.id));
    expect(ipad!.lastSeenAt).toEqual(minute(2, 6));
  });

  it('never counts the same query twice across runs', async () => {
    await seedHome(handle.db);
    fake.logQuery(minute(1), 'ft-ollieipad', 'youtube.com');
    await readUsage({ db: handle.db, adguard, now: () => minute(2), log });
    fake.logQuery(minute(2, 30), 'ft-ollieipad', 'youtube.com');
    await readUsage({ db: handle.db, adguard, now: () => minute(3), log });
    const total = (await handle.db.select().from(usageMinutes)).reduce((n, x) => n + x.queries, 0);
    expect(total).toBe(2);
  });

  it('matches a device by its IP when AdGuard has no name for the query', async () => {
    await seedHome(handle.db);
    fake.querylog.push({ time: minute(1).toISOString(), client: '192.168.1.50', question: { name: 'roblox.com', type: 'A' } });
    await readUsage({ db: handle.db, adguard, now: () => minute(2), log });
    expect(await handle.db.select().from(usageMinutes)).toHaveLength(1);
  });
});

describe('quiet devices', () => {
  it('are marked after 30 silent minutes in the day, and cleared when heard from again', async () => {
    const s = await seedHome(handle.db);
    await handle.db.update(devices).set({ lastSeenAt: minute(-31) }).where(eq(devices.id, s.ipad.id));
    expect(await markQuiet(handle.db, FREE_TIME)).toEqual([s.ipad.id]);
    fake.logQuery(minute(1), 'ft-ollieipad', 'example.org');
    await readUsage({ db: handle.db, adguard, now: () => minute(2), log });
    const [ipad] = await handle.db.select().from(devices).where(eq(devices.id, s.ipad.id));
    expect(ipad!.quietSince).toBeNull();
  });

  it('are not marked at bedtime, when silence is the point', async () => {
    const s = await seedHome(handle.db);
    await handle.db.update(devices).set({ lastSeenAt: new Date(BEDTIME.getTime() - 3_600_000) }).where(eq(devices.id, s.ipad.id));
    expect(await markQuiet(handle.db, BEDTIME)).toEqual([]);
  });
});

describe('helpers', () => {
  it('read the domain from a built-in rule', () => {
    expect(ruleDomain('||youtube.com^')).toBe('youtube.com');
    expect(ruleDomain('/regex/')).toBeUndefined();
  });

  it('match a query to the most specific service domain', () => {
    const map = new Map([
      ['google.com', 'google'],
      ['youtube.google.com', 'youtube'],
    ]);
    expect(serviceFor('m.youtube.google.com.', map)).toBe('youtube');
    expect(serviceFor('mail.google.com', map)).toBe('google');
    expect(serviceFor('notgoogle.com', map)).toBeUndefined();
  });

  it('estimate minutes from busy minutes only', () => {
    expect(estimateMinutes([{ queries: 1 }, { queries: 3 }, { queries: 9 }])).toBe(2);
  });
});
