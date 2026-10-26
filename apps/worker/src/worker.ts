import { recordHeartbeat, type Db } from '@family-time/db';
import type { PgBoss } from 'pg-boss';

export const HEARTBEAT_QUEUE = 'heartbeat';
export const HEARTBEAT_INTERVAL_MS = 30_000;

export type Log = (level: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void;

export interface WorkerDeps {
  boss: PgBoss;
  db: Db;
  commit: string;
  now: () => Date;
  log: Log;
  intervalMs?: number;
  pollingIntervalSeconds?: number;
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

  const beat = async () => {
    try {
      await boss.send(HEARTBEAT_QUEUE, {}, { singletonKey: 'beat' });
    } catch (err) {
      log('error', 'heartbeat_send_failed', { error: (err as Error).message });
    }
  };
  await beat();
  const timer = setInterval(() => void beat(), deps.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  log('info', 'started', { commit });

  return {
    stop: async () => {
      clearInterval(timer);
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
