import { readHeartbeat } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import { fromPglite, PgBoss } from 'pg-boss';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonLog, startWorker, type RunningWorker } from '../src/worker.js';

let handle: TestDb | undefined;
let worker: RunningWorker | undefined;
afterEach(async () => {
  await worker?.stop();
  await handle?.close();
  worker = undefined;
  handle = undefined;
});

async function until<T>(read: () => Promise<T | undefined>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`nothing after ${ms} ms`);
}

describe('worker', () => {
  it('writes the heartbeat through the job queue', async () => {
    handle = await testDb();
    const boss = new PgBoss({ db: fromPglite(handle.client) });
    const lines: string[] = [];
    const at = new Date('2026-10-26T18:32:00Z');
    worker = await startWorker({
      boss,
      db: handle.db,
      commit: 'abc123',
      now: () => at,
      log: jsonLog('worker', 'debug', (l) => lines.push(l)),
      pollingIntervalSeconds: 0.5,
    });
    const beat = await until(() => readHeartbeat(handle!.db));
    expect(beat).toEqual({ beatAt: at, commit: 'abc123', chainSeenAt: null, adguardSeenAt: null });
    expect(lines.map((l) => JSON.parse(l).event)).toContain('heartbeat');
  });
});

describe('control jobs', () => {
  it('reconcile through the job queue as soon as the worker starts', async () => {
    const { AdGuard } = await import('@family-time/adguard-client');
    const { FakeAdGuard } = await import('@family-time/adguard-client/fake');
    const { seedHome, FREE_TIME } = await import('./seed.js');
    handle = await testDb();
    await seedHome(handle.db);
    const fake = new FakeAdGuard();
    const adguard = new AdGuard({ baseUrl: await fake.start(), username: fake.username, password: fake.password });
    try {
      worker = await startWorker({
        boss: new PgBoss({ db: fromPglite(handle.client) }),
        db: handle.db,
        commit: 'abc123',
        now: () => FREE_TIME,
        log: jsonLog('worker', 'error', () => undefined),
        pollingIntervalSeconds: 0.5,
        adguard,
      });
      const ipad = await until(async () => fake.clients.find((c) => c.name === 'ft-ollieipad'));
      expect(ipad.blocked_services).toEqual(['roblox', 'youtube']);
    } finally {
      await worker?.stop();
      worker = undefined;
      await fake.stop();
    }
  });
});

describe('jsonLog', () => {
  it('writes the shared line shape and drops lines below the level', () => {
    const lines: string[] = [];
    const log = jsonLog('worker', 'info', (l) => lines.push(l));
    log('debug', 'quiet');
    log('info', 'loud', { n: 1 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'info', app: 'family-time', service: 'worker', event: 'loud', n: 1 });
  });
});
