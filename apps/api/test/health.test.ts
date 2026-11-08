import { latestMigrationTag, ledgerContracts, recordChainSeen } from '@family-time/db';
import { Liveness, Readiness, Version } from '@family-time/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { readiness } from '../src/health.js';
import { harness, NOW, type Harness } from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const checksOf = (body: unknown) =>
  Object.fromEntries(Readiness.parse(body).checks.map((c) => [c.name, c]));

describe('/healthz', () => {
  it('answers ok without touching the database', async () => {
    h = await harness();
    await h.handle.close(); // database gone
    const res = await h.app.inject('/healthz');
    expect(res.statusCode).toBe(200);
    expect(Liveness.parse(res.json())).toEqual({ status: 'ok' });
  });
});

describe('/readyz', () => {
  it('is ready when the database answers, the schema is current and the worker beat recently', async () => {
    h = await harness();
    const res = await h.app.inject('/readyz');
    expect(res.statusCode).toBe(200);
    const body = Readiness.parse(res.json());
    expect(body.status).toBe('ready');
    expect(body.checks.map((c) => c.name)).toEqual(['database', 'schema', 'worker']);
  });

  it('is not ready, with a reason, when migrations have not run', async () => {
    h = await harness({ migrated: false, heartbeat: false });
    const res = await h.app.inject('/readyz');
    expect(res.statusCode).toBe(503);
    const checks = checksOf(res.json());
    expect(checks.database?.ok).toBe(true);
    expect(checks.schema?.detail).toMatch(/0 of \d+ migrations applied/);
  });

  it('is not ready when the worker has never beaten', async () => {
    h = await harness({ heartbeat: false });
    const res = await h.app.inject('/readyz');
    expect(res.statusCode).toBe(503);
    expect(checksOf(res.json()).worker?.detail).toMatch(/no heartbeat yet/);
  });

  it('is not ready when the heartbeat is stale', async () => {
    h = await harness({ heartbeat: false });
    await h.handle.client.query(`insert into worker_heartbeat (id, beat_at, "commit") values (1, $1, 'old')`, [
      new Date(NOW.getTime() - 5 * 60_000),
    ]);
    const res = await h.app.inject('/readyz');
    expect(res.statusCode).toBe(503);
    expect(checksOf(res.json()).worker?.detail).toMatch(/last heartbeat at/);
  });

  it('is not ready when the database is gone, and still answers', async () => {
    h = await harness();
    await h.handle.close();
    const res = await h.app.inject('/readyz');
    expect(res.statusCode).toBe(503);
    expect(checksOf(res.json()).database?.ok).toBe(false);
  });

  it('checks AdGuard answers, when it has a password', async () => {
    h = await harness();
    const build = { app: 'family-time', commit: 'abc123', builtAt: '2026-10-26T18:00:00Z', schema: latestMigrationTag(), drillUnready: false };
    const up = await readiness({ db: h.handle.db, build, now: () => NOW, pingAdguard: async () => undefined });
    expect(up.status).toBe('ready');
    expect(up.checks.map((c) => c.name)).toEqual(['database', 'schema', 'worker', 'adguard']);
    const down = await readiness({ db: h.handle.db, build, now: () => NOW, pingAdguard: async () => Promise.reject(new Error("AdGuard's admin API is not answering: connect ECONNREFUSED")) });
    expect(down.status).toBe('not_ready');
    expect(down.checks.find((c) => c.name === 'adguard')?.detail).toMatch(/not answering/);
  });

  it('with the Besu ledger, checks the worker reached the node lately, once there is a contract', async () => {
    h = await harness();
    const build = { app: 'family-time', commit: 'abc123', builtAt: '2026-10-26T18:00:00Z', schema: latestMigrationTag(), drillUnready: false };
    const check = async () => (await readiness({ db: h!.handle.db, build, now: () => NOW, ledgerAdapter: 'besu' })).checks.find((c) => c.name === 'besu')!;
    // No contract yet: nothing to reach.
    expect((await check()).ok).toBe(true);
    await h.handle.db.insert(ledgerContracts).values({ address: '0x0000000000000000000000000000000000000001', chainId: 1337, version: '1', deployedBlock: 1, active: true });
    expect((await check()).detail).toBe('the worker has not reached the Besu node yet');
    await recordChainSeen(h.handle.db, new Date(NOW.getTime() - 5 * 60_000));
    expect((await check()).detail).toMatch(/last reached the Besu node at/);
    await recordChainSeen(h.handle.db, NOW);
    expect((await check()).ok).toBe(true);
  });

  it('tells only callers inside the server which check failed', async () => {
    h = await harness({ heartbeat: false });
    const outside = await h.app.inject({ url: '/readyz', remoteAddress: '203.0.113.9' });
    expect(outside.statusCode).toBe(503);
    expect(outside.json()).toEqual({ status: 'not_ready' });
  });

  it('is never ready in a rollback drill build', async () => {
    h = await harness({ build: { drillUnready: true } });
    const res = await h.app.inject('/readyz');
    expect(res.statusCode).toBe(503);
    expect(checksOf(res.json()).drill?.detail).toMatch(/drill-rollback/);
  });
});

describe('/version', () => {
  it('reports the baked-in commit, build time and the newest shipped migration', async () => {
    h = await harness();
    const res = await h.app.inject('/version');
    expect(Version.parse(res.json())).toEqual({
      app: 'family-time',
      commit: 'abc123',
      builtAt: '2026-10-26T18:00:00Z',
      schema: latestMigrationTag(),
    });
  });
});
