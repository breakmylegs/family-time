// The worker answers the discovery helper for the api, which holds no AdGuard password (ADR 0022):
// one device's questions in the last 30 minutes, time, client and domain only.
import { AdGuard } from '@family-time/adguard-client';
import { FakeAdGuard } from '@family-time/adguard-client/fake';
import { discoveryRequests } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adguardAnswered, answerDiscovery } from '../src/discover.js';
import { FREE_TIME, seedHome } from './seed.js';

let handle: TestDb;
let fake: FakeAdGuard;
let adguard: AdGuard;

beforeEach(async () => {
  handle = await testDb();
  fake = new FakeAdGuard();
  adguard = new AdGuard({ baseUrl: await fake.start(), username: fake.username, password: fake.password });
});
afterEach(async () => {
  await fake.stop();
  await handle.close();
});

const ago = (min: number) => new Date(FREE_TIME.getTime() - min * 60_000).toISOString();

describe('the discovery helper, answered by the worker', () => {
  it("returns only that device's questions from the last 30 minutes, with nothing else about them", async () => {
    const s = await seedHome(handle.db);
    fake.querylog = [
      { time: ago(1), client: '192.168.1.50', client_info: { name: 'ft-ollieipad' }, question: { name: 'cdn.newgame.example', type: 'A' }, reason: 'NotFilteredNotFound' },
      { time: ago(2), client: '192.168.1.77', client_info: { name: 'dad-laptop' }, question: { name: 'work.example', type: 'A' }, reason: 'NotFilteredNotFound' },
      { time: ago(45), client: '192.168.1.50', client_info: { name: 'ft-ollieipad' }, question: { name: 'old.example', type: 'A' }, reason: 'NotFilteredNotFound' },
    ];
    const [req] = await handle.db.insert(discoveryRequests).values({ deviceId: s.ipad.id, requestedAt: FREE_TIME }).returning();
    await answerDiscovery(handle.db, adguard, req!.id, FREE_TIME);
    const [row] = await handle.db.select().from(discoveryRequests).where(eq(discoveryRequests.id, req!.id));
    expect(row!.error).toBeNull();
    expect(row!.finishedAt).not.toBeNull();
    expect(row!.result).toEqual([{ time: ago(1), client: '192.168.1.50', client_info: { name: 'ft-ollieipad' }, question: { name: 'cdn.newgame.example', type: 'A' } }]);
  });

  it('says why when AdGuard is not set up or cannot be read', async () => {
    const s = await seedHome(handle.db);
    const [a] = await handle.db.insert(discoveryRequests).values({ deviceId: s.ipad.id, requestedAt: FREE_TIME }).returning();
    await answerDiscovery(handle.db, undefined, a!.id, FREE_TIME);
    expect((await handle.db.select().from(discoveryRequests).where(eq(discoveryRequests.id, a!.id)))[0]!.error).toMatch(/not set up yet/);
    const wrong = new AdGuard({ baseUrl: await restart(), username: fake.username, password: 'wrong' });
    const [b] = await handle.db.insert(discoveryRequests).values({ deviceId: s.ipad.id, requestedAt: FREE_TIME }).returning();
    await answerDiscovery(handle.db, wrong, b!.id, FREE_TIME);
    expect((await handle.db.select().from(discoveryRequests).where(eq(discoveryRequests.id, b!.id)))[0]!.error).toMatch(/could not be read/);
  });

  it('counts any answer from AdGuard as reaching it, even a refused login, but not silence', async () => {
    expect(await adguardAnswered(adguard)).toBe(true);
    expect(await adguardAnswered(new AdGuard({ baseUrl: await restart(), username: fake.username, password: 'wrong' }))).toBe(true);
    await fake.stop();
    expect(await adguardAnswered(new AdGuard({ baseUrl: 'http://127.0.0.1:9', username: 'x', password: 'y', timeoutMs: 1000 }))).toBe(false);
    fake = new FakeAdGuard();
    await fake.start();
  });
});

async function restart() {
  await fake.stop();
  return fake.start();
}
