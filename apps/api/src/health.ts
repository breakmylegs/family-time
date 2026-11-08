import { activeContract } from '@family-time/ledger';
import { appliedMigrationCount, CHAIN_STALE_AFTER_MS, heartbeatFresh, readHeartbeat, shippedMigrationCount, type Db } from '@family-time/db';
import type { CheckResult, Readiness } from '@family-time/schemas';
import { sql } from 'drizzle-orm';
import type { BuildInfo } from './build.js';

export const CHECK_TIMEOUT_MS = 2_000;

export interface ReadinessDeps {
  db: Db;
  build: BuildInfo;
  now: () => Date;
  timeoutMs?: number;
  /** Asks AdGuard's admin API anything. Absent until AdGuard has a password (init.sh). */
  pingAdguard?: () => Promise<void>;
  /** With the Besu ledger, the node must be reachable from the worker. */
  ledgerAdapter?: 'postgres' | 'besu';
}

type Check = () => Promise<string | undefined>;

/** Runs one check with its own timeout. Returns what went wrong, or nothing when it passed. */
async function run(name: string, check: Check, timeoutMs: number): Promise<CheckResult> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`no answer within ${timeoutMs} ms`), timeoutMs);
  });
  let detail: string | undefined;
  try {
    detail = await Promise.race([check(), timeout]);
  } catch (err) {
    detail = (err as Error).message || String(err);
  } finally {
    clearTimeout(timer);
  }
  const ms = Math.round(performance.now() - started);
  return detail === undefined ? { name, ok: true, ms } : { name, ok: false, detail, ms };
}

/**
 * Hard dependencies only. Each check says what it proves:
 * - database: Postgres answers a query.
 * - schema: every migration this image ships has been applied. More is fine (after a rollback
 *   the previous image runs on a newer, additive schema).
 * - worker: the worker's heartbeat job ran recently, so the job queue is moving.
 * - adguard: AdGuard's admin API answers on the internal network. Any answer counts, even "not set
 *   up yet", so a fresh install is ready before ./scripts/ft.sh adguard-setup has run. Whether it
 *   blocks is the worker's job to watch: it alerts parents when protection is off.
 * - besu (Besu ledger only): the worker reached the node in the last two minutes. The api has no
 *   route to the node (ADR 0014), so it reads the time the worker recorded. Before the contract is
 *   deployed there is nothing to reach yet, and it passes.
 */
export async function readiness(deps: ReadinessDeps): Promise<Readiness> {
  const { db, build, now } = deps;
  const timeoutMs = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
  const checks: [string, Check][] = [
    [
      'database',
      async () => {
        await db.execute(sql`select 1`);
        return undefined;
      },
    ],
    [
      'schema',
      async () => {
        const applied = await appliedMigrationCount(db);
        const shipped = shippedMigrationCount();
        return applied >= shipped ? undefined : `${applied} of ${shipped} migrations applied. Run the migrate service`;
      },
    ],
    [
      'worker',
      async () => {
        const beat = await readHeartbeat(db);
        if (!beat) return 'no heartbeat yet. Is the worker running?';
        return heartbeatFresh(beat.beatAt, now()) ? undefined : `last heartbeat at ${beat.beatAt.toISOString()}`;
      },
    ],
  ];
  if (deps.pingAdguard) {
    const ping = deps.pingAdguard;
    checks.push([
      'adguard',
      async () => {
        await ping();
        return undefined;
      },
    ]);
  }
  if (deps.ledgerAdapter === 'besu') {
    checks.push([
      'besu',
      async () => {
        if (!(await activeContract(db))) return undefined;
        const seen = (await readHeartbeat(db))?.chainSeenAt;
        if (!seen) return 'the worker has not reached the Besu node yet';
        return now().getTime() - seen.getTime() <= CHAIN_STALE_AFTER_MS ? undefined : `the worker last reached the Besu node at ${seen.toISOString()}`;
      },
    ]);
  }
  if (build.drillUnready) {
    checks.push(['drill', async () => 'built by drill-rollback.sh, never ready on purpose']);
  }
  const results = await Promise.all(checks.map(([name, check]) => run(name, check, timeoutMs)));
  return { status: results.every((r) => r.ok) ? 'ready' : 'not_ready', checks: results };
}
