import { latestMigrationTag } from '@family-time/db';
import { Liveness, Readiness, Version } from '@family-time/schemas';
import { afterEach, describe, expect, it } from 'vitest';
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
