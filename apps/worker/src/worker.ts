import type { AdGuard } from '@family-time/adguard-client';
import { recordHeartbeat, type Db } from '@family-time/db';
import type { PgBoss } from 'pg-boss';
import { reconcile } from './reconcile.js';
import { readUsage } from './usage.js';

export const HEARTBEAT_QUEUE = 'heartbeat';
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** The api sends a job here after every change, and the worker sends one every minute. */
export const RECONCILE_QUEUE = 'reconcile';
export const USAGE_QUEUE = 'usage';
export const CONTROL_INTERVAL_MS = 60_000;

export type Log = (level: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void;

export interface WorkerDeps {
  boss: PgBoss;
  db: Db;
  commit: string;
  now: () => Date;
  log: Log;
  intervalMs?: number;
  pollingIntervalSeconds?: number;
  /** Absent until AdGuard is set up: the control jobs then do nothing and say why. */
  adguard?: AdGuard;
  controlIntervalMs?: number;
}

export interface RunningWorker {
  stop: () => Promise<void>;
}

/**
 * The heartbeat goes through the job queue on purpose: the api's readiness reads the row the
 * job writes, so a fresh heartbeat proves pg-boss is moving, not just that this process is up.
 */
export async function startWorker(deps: WorkerDeps): Promise<RunningWorker> {
  const { boss, db, commit, now, log } = deps;
  boss.on('error', (err: Error) => log('error', 'queue_error', { error: err.message }));
  await boss.start();
  if (!(await boss.getQueue(HEARTBEAT_QUEUE))) await boss.createQueue(HEARTBEAT_QUEUE);

  await boss.work(HEARTBEAT_QUEUE, { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 }, async () => {
    await recordHeartbeat(db, commit, now());
    log('debug', 'heartbeat');
  });

  // Control jobs. Singleton queues: never two reconciles at once, so AdGuard has one writer.
  for (const queue of [RECONCILE_QUEUE, USAGE_QUEUE]) {
    if (!(await boss.getQueue(queue))) await boss.createQueue(queue, { policy: 'singleton' });
  }
  const adguard = deps.adguard;
  await boss.work(RECONCILE_QUEUE, { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 }, async () => {
    if (!adguard) return log('debug', 'reconcile_skipped', { reason: 'AdGuard is not set up. Run ./scripts/ft.sh adguard-setup' });
    const result = await reconcile({ db, adguard, now, log });
    log(result.failed ? 'warn' : 'debug', 'reconciled', { ...result });
  });
  await boss.work(USAGE_QUEUE, { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 }, async () => {
    if (!adguard) return;
    const result = await readUsage({ db, adguard, now, log });
    log('debug', 'usage_read', { ...result });
  });

  const send = async (queue: string, key: string) => {
    try {
      await boss.send(queue, {}, { singletonKey: key });
    } catch (err) {
      log('error', 'send_failed', { queue, error: (err as Error).message });
    }
  };
  const beat = () => send(HEARTBEAT_QUEUE, 'beat');
  const control = async () => {
    await send(RECONCILE_QUEUE, 'tick');
    await send(USAGE_QUEUE, 'tick');
  };
  await beat();
  await control();
  const timer = setInterval(() => void beat(), deps.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  const controlTimer = setInterval(() => void control(), deps.controlIntervalMs ?? CONTROL_INTERVAL_MS);
  log('info', 'started', { commit, adguard: Boolean(adguard) });

  return {
    stop: async () => {
      clearInterval(timer);
      clearInterval(controlTimer);
      await boss.stop({ graceful: true, timeout: 10_000 });
      log('info', 'stopped');
    },
  };
}

/** Same line shape as the api: time, level, app, service, event. */
export function jsonLog(service: string, minLevel: string, write: (line: string) => void = (l) => process.stdout.write(l)): Log {
  const order = ['debug', 'info', 'warn', 'error'];
  const min = Math.max(0, order.indexOf(minLevel));
  return (level, event, fields = {}) => {
    if (order.indexOf(level) < min) return;
    write(`${JSON.stringify({ time: new Date().toISOString(), level, app: 'family-time', service, event, ...fields })}\n`);
  };
}
