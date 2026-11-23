import type { AdGuard } from '@family-time/adguard-client';
import { households, recordAdguardSeen, recordChainSeen, recordHeartbeat, sweep, type Db } from '@family-time/db';
import { activeContract, checkAgainstChain, indexPass, postgresLedger, signerPass, type ChainClient, type LedgerPort } from '@family-time/ledger';
import type { Send, Vapid } from '@family-time/notify';
import type { PgBoss } from 'pg-boss';
import { sendDeviceAlerts, sendFamilyAlert, type AlertJob, type DeviceAlertKind } from './alerts.js';
import { economyTick } from './economy.js';
import { backupProblem } from './backups.js';
import { prunePhotos } from './photos.js';
import { adguardAnswered, answerDiscovery, DISCOVER_QUEUE } from './discover.js';
import { reconcile } from './reconcile.js';
import { adguardProblem, AdGuardWatch, reviewsDue } from './watch.js';
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
/** The Besu signer and indexer (ADR 0014): one queue, one at a time, every few seconds. */
export const LEDGER_QUEUE = 'ledger-chain';
export const LEDGER_INTERVAL_MS = 5_000;
/** How often the chain is compared with Postgres, entry by entry and balance by balance. */
export const CHAIN_CHECK_MS = 24 * 3_600_000;
/** Retention runs once a day, and once after each start. */
export const RETENTION_MS = 24 * 3_600_000;
/** The backup check runs every few hours; an owner hears about a problem at most once a day. */
export const BACKUP_CHECK_MS = 6 * 3_600_000;
export const BACKUP_ALERT_MS = 24 * 3_600_000;

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
  /** The ledger. The Postgres one unless a test or the Besu adapter says otherwise. */
  ledger?: LedgerPort;
  /** With the Besu adapter: the chain, for whichever contract is active. */
  chain?: (contract: `0x${string}`) => ChainClient;
  ledgerIntervalMs?: number;
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
  // Zero, so both run on the first tick after a start.
  let sweptAt = 0;
  let backupCheckedAt = 0;
  const backupAlertedAt = new Map<string, number>();
  await boss.work(ECONOMY_QUEUE, { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 }, async () => {
    const result = await economyTick({ db, ledger, now, log, onChainBroken: (householdId, problem) => queueAlert({ kind: 'ledger', householdId, problem }) });
    const photos = await prunePhotos(db, now());
    if (photos) log('info', 'photos_deleted', { count: photos });
    if (now().getTime() - sweptAt > RETENTION_MS) {
      sweptAt = now().getTime();
      try {
        const counts = await sweep(db, now());
        log(Object.keys(counts).length ? 'info' : 'debug', 'retention', counts);
      } catch (err) {
        log('error', 'retention_failed', { error: (err as Error).message });
      }
    }
    if (now().getTime() - backupCheckedAt > BACKUP_CHECK_MS) {
      backupCheckedAt = now().getTime();
      for (const h of await db.select({ id: households.id }).from(households)) {
        const problem = await backupProblem(db, h.id, now());
        if (problem && now().getTime() - (backupAlertedAt.get(h.id) ?? 0) > BACKUP_ALERT_MS) {
          backupAlertedAt.set(h.id, now().getTime());
          log('warn', 'backup_problem', { householdId: h.id, problem });
          await queueAlert({ kind: 'backup', householdId: h.id, problem });
        }
      }
    }
    // The family review: an hour before the week resets, once a week.
    for (const r of await reviewsDue(db, now())) {
      await queueAlert({ kind: 'review', householdId: r.householdId, resets: r.resets.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: r.timeZone }) });
    }
    log(result.closed || result.allocated || result.refunds || result.charges ? 'info' : 'debug', 'economy', { ...result });
  });
  // The signer, then the indexer. Singleton, so there is only ever one signer and nonces never clash.
  const chainFor = deps.chain;
  // When the chain was last compared with Postgres. Once a day, and once after each start.
  let checkedAt = 0;
  if (chainFor) {
    if (!(await boss.getQueue(LEDGER_QUEUE))) await boss.createQueue(LEDGER_QUEUE, { policy: 'singleton' });
    await boss.work(LEDGER_QUEUE, { pollingIntervalSeconds: 1 }, async () => {
      const c = await activeContract(db);
      if (!c) return log('debug', 'ledger_chain_skipped', { reason: 'No contract yet. Run ./scripts/ft.sh ledger-deploy' });
      const chain = chainFor(c.address as `0x${string}`);
      try {
        const signed = await signerPass(db, chain, {
          onFailed: async (f) => {
            log('error', 'ledger_tx_failed', { ref: f.entryRef, reason: f.reason });
            if (f.householdId) await queueAlert({ kind: 'ledger', householdId: f.householdId, problem: `The chain refused entry "${f.entryRef}" (${f.reason}), so nothing more is being written to it.` });
          },
        });
        const indexed = await indexPass(db, chain);
        await recordChainSeen(db, now());
        log(signed.sent || indexed.confirmed ? 'info' : 'debug', 'ledger_chain', { ...signed, confirmed: indexed.confirmed, block: indexed.to });
        // Only when the queue is empty, so entries on their way are not counted as missing. A
        // stolen signer key could write named entries Postgres never made; this is how the owner
        // hears of it (ADR 0014).
        if (!signed.queued && !signed.waiting && !signed.sent && Date.now() - checkedAt > CHAIN_CHECK_MS) {
          checkedAt = Date.now();
          const check = await checkAgainstChain(db, chain);
          log(check.ok ? 'info' : 'error', 'ledger_chain_checked', { ok: check.ok, entries: check.entries, events: check.events, problems: check.problems.length });
          if (!check.ok) {
            for (const h of await db.select({ id: households.id }).from(households)) {
              await queueAlert({ kind: 'ledger', householdId: h.id, problem: `The chain and Postgres differ (${check.problems.length} problems). Run ./scripts/ft.sh ledger-check for details.` });
            }
          }
        }
      } catch (err) {
        // The node is down or restarting: the queue keeps everything, and the next pass carries on.
        log('warn', 'ledger_chain_unreachable', { error: (err as Error).message });
      }
    });
  }
  const adguardWatch = new AdGuardWatch();
  // The discovery helper, for the api, which holds no AdGuard password (ADR 0022).
  if (!(await boss.getQueue(DISCOVER_QUEUE))) await boss.createQueue(DISCOVER_QUEUE);
  await boss.work<{ id: string }>(DISCOVER_QUEUE, { pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await answerDiscovery(db, adguard, job.data.id, now());
  });
  await boss.work(RECONCILE_QUEUE, { pollingIntervalSeconds: deps.pollingIntervalSeconds ?? 2 }, async () => {
    if (!adguard) return log('debug', 'reconcile_skipped', { reason: 'AdGuard is not set up. Run ./scripts/ft.sh adguard-setup' });
    // For the api's readiness, which cannot ask AdGuard itself: any answer counts.
    if (await adguardAnswered(adguard)) await recordAdguardSeen(db, now());
    const problem = await adguardProblem(adguard);
    const turn = adguardWatch.observe(problem);
    if (problem) log('warn', 'adguard_unwell', { problem });
    if (turn) {
      for (const h of await db.select({ id: households.id }).from(households)) await queueAlert({ kind: 'adguard', householdId: h.id, problem: turn === 'down' ? problem : null });
    }
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
  const ledgerTimer = chainFor ? setInterval(() => void send(LEDGER_QUEUE, 'tick'), deps.ledgerIntervalMs ?? LEDGER_INTERVAL_MS) : undefined;
  log('info', 'started', { commit, adguard: Boolean(adguard), ledger: chainFor ? 'besu' : 'postgres' });

  return {
    stop: async () => {
      clearInterval(timer);
      clearInterval(controlTimer);
      clearInterval(ledgerTimer);
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
