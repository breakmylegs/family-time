import { afterEach, describe, expect, it } from 'vitest';
import { HEARTBEAT_STALE_AFTER_MS, heartbeatFresh, readHeartbeat, recordHeartbeat } from '../src/index.js';
import { testDb, type TestDb } from '../src/testing.js';

let handle: TestDb | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

describe('heartbeat', () => {
  it('keeps one row and moves it forward', async () => {
    handle = await testDb();
    expect(await readHeartbeat(handle.db)).toBeUndefined();
    await recordHeartbeat(handle.db, 'aaa', new Date('2026-10-26T10:00:00Z'));
    await recordHeartbeat(handle.db, 'bbb', new Date('2026-10-26T10:00:30Z'));
    expect(await readHeartbeat(handle.db)).toEqual({ beatAt: new Date('2026-10-26T10:00:30Z'), commit: 'bbb', chainSeenAt: null, adguardSeenAt: null });
    const count = await handle.client.query<{ n: number }>('select count(*)::int as n from worker_heartbeat');
    expect(count.rows[0]?.n).toBe(1);
  });

  it('refuses a second row', async () => {
    handle = await testDb();
    await expect(
      handle.client.query(`insert into worker_heartbeat (id, beat_at, "commit") values (2, now(), 'x')`),
    ).rejects.toThrow(/worker_heartbeat_single_row/);
  });

  it('is fresh up to the limit and stale after it', () => {
    const now = new Date('2026-10-26T10:00:00Z');
    expect(heartbeatFresh(undefined, now)).toBe(false);
    expect(heartbeatFresh(new Date(now.getTime() - HEARTBEAT_STALE_AFTER_MS), now)).toBe(true);
    expect(heartbeatFresh(new Date(now.getTime() - HEARTBEAT_STALE_AFTER_MS - 1), now)).toBe(false);
    expect(heartbeatFresh(new Date(now.getTime() + 5_000), now)).toBe(true);
  });
});
