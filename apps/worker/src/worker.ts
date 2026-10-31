import type { AdGuard } from '@family-time/adguard-client';
import { recordHeartbeat, type Db } from '@family-time/db';
import { postgresLedger, type LedgerPort } from '@family-time/ledger';
import type { Send, Vapid } from '@family-time/notify';
import type { PgBoss } from 'pg-boss';
import { sendDeviceAlerts, sendFamilyAlert, type AlertJob, type DeviceAlertKind } from './alerts.js';
import { economyTick } from './economy.js';
import { reconcile } from './reconcile.js';
import { readUsage } from './usage.js';

export const HEARTBEAT_QUEUE = 'heartbeat';
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** The api sends a job here after every change, and the worker sends one every minute. */
export const RECONCILE_QUEUE = 'reconcile';
export const USAGE_QUEUE = 'usage';
/** Alerts to parents' phones. Their own queue: a push service that is slow or down never delays AdGuard. */
export const ALERT_QUEUE = 'alerts';
/** The week close, session refunds, counted Allows and the nightly chain check. */
export const ECONOMY_QUEUE = 'economy';
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
  /** Tells the api's open Control screens to refresh. Postgres NOTIFY in production. */
  notifyChange?: () => Promise<void>;
  /** Web Push to parents. Absent until init.sh has made the VAPID key. */
  push?: { vapid: Vapid; send?: Send };
  /** The ledger. The Postgres one unless a test or Phase 5 says otherwise. */
  ledger?: LedgerPort;
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
  for (const queue of [RECONCILE_QUEUE, USAGE_QUEUE, ECONOMY_QUEUE]) {
    if (!(await boss.getQueue(queue))) await boss.createQueue(queue, { policy: 'singleton' });
  }
  const adguard = deps.adguard;
  // Neither may fail a job: the state is recorded, and the next run tries again.
  const changed = async () => {
    try {
      await deps.notifyChange?.();
    } catch (err) {
      log('warn', 'notify_failed', { error: (err as Error).message });
    }
  };
  if (!(await boss.getQueue(ALERT_QUEUE))) await boss.createQueue(ALERT_QUEUE);
  const queueAlert = async (job: AlertJob) => {
    if (!deps.push) return log('warn', 'alert_skipped', { kind: job.kind, reason: 'No VAPID key. Run ./scripts/init.sh' });
    try {
      await boss.send(ALERT_QUEUE, job, { expireInSeconds: 120 });
    } catch (err) {
      log('error', 'alert_not_queued', { kind: job.kind, error: (err as Error).message });
    }
  };
  const alert = async (kind: DeviceAlertKind, deviceIds: string[]) => {
    if (deviceIds.length) await queueAlert({ kind, deviceIds });
  };
  await boss.work<AlertJob>(ALERT_QUEUE, { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 }, async (jobs) => {
    if (!deps.push) return;
    for (const job of jobs) {
      try {
        const data = job.data;
        if ('deviceIds' in data) await sendDeviceAlerts({ db, log, ...deps.push }, data.kind, data.deviceIds);
        else await sendFamilyAlert({ db, log, ...deps.push }, data);
      } catch (err) {
        log('error', 'alert_failed', { kind: job.data.kind, error: (err as Error).message });
      }
    }
  });
  const ledger = deps.ledger ?? postgresLedger(db);
  await boss.work(ECONOMY_QUEUE, { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 }, async () => {
    const result = await economyTick({ db, ledger, now, log, onChainBroken: (householdId, problem) => queueAlert({ kind: 'ledger', householdId, problem }) });
    log(result.closed || result.allocated || result.refunds || result.charges ? 'info' : 'debug', 'economy', { ...result });
  });
  await boss.work(RECONCILE_QUEUE, { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 }, async () => {
    if (!adguard) return log('debug', 'reconcile_skipped', { reason: 'AdGuard is not set up. Run ./scripts/ft.sh adguard-setup' });
    const result = await reconcile({ db, adguard, now, log });
    log(result.failed ? 'warn' : 'debug', 'reconciled', { ...result });
    await changed();
    await alert('not-confirmed', result.notConfirmed ?? []);
  });
  await boss.work(USAGE_QUEUE, { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 }, async () => {
    if (!adguard) return;
    const result = await readUsage({ db, adguard, now, log });
    log('debug', 'usage_read', { ...result });
    await changed();
    await alert('quiet', result.quiet);
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
    await send(ECONOMY_QUEUE, 'tick');
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
