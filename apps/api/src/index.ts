import type { QueryLogItem } from '@family-time/adguard-client';
import { ADGUARD_STALE_AFTER_MS, connectionConfig, discoveryRequests, readHeartbeat, schema, type Db } from '@family-time/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { besuLedger, postgresLedger } from '@family-time/ledger';
import { CHANGE_CHANNEL, vapidFromFile, vapidPublicFromFile } from '@family-time/notify';
import { Oidc } from './auth/oidc.js';
import { readBuildInfo } from './build.js';
import { Changes } from './events.js';
import { buildKioskServer } from './kiosk/server.js';
import { buildServer } from './server.js';

const pool = new pg.Pool({ ...connectionConfig(), max: 10 });
const db = drizzle(pool, { schema }) as unknown as Db;
const build = readBuildInfo();
// The parent app's build sits beside the api in the image (apps/parent/dist).
const staticDir = process.env.PARENT_DIST ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'parent', 'dist');

// After every change, a reconcile job: the worker picks it up within seconds.
const boss = new PgBoss({ ...connectionConfig(), max: 2 } as ConstructorParameters<typeof PgBoss>[0]);
boss.on('error', (err: Error) => console.error(JSON.stringify({ level: 'error', app: 'family-time', service: 'api', event: 'queue_error', error: err.message })));
await boss.start();
const notifyChange = async () => {
  await boss.send('reconcile', {}, { singletonKey: 'change' });
};

// The api holds no AdGuard password (ADR 0022): it faces the internet, and that password controls
// the home's DNS. The worker talks to AdGuard; the api reads when the worker last reached it, for
// readiness, and asks the worker for a device's recent questions, for the discovery helper.
const adguardInUse = Boolean(process.env.ADGUARD_MODE);

// The worker NOTIFYs after each reconcile and usage run, so "Working on his iPad now" appears on
// open Control screens without a refresh. One client holds the LISTEN; it reconnects if dropped.
const changes = new Changes();
let listener: pg.Client | undefined;
let stopping = false;
const listen = async () => {
  if (stopping) return;
  const client = new pg.Client(connectionConfig());
  client.on('notification', (msg) => {
    if (msg.channel === CHANGE_CHANNEL && msg.payload) changes.emit(msg.payload);
  });
  let retried = false;
  const retry = () => {
    if (retried || stopping) return;
    retried = true;
    listener = undefined;
    void client.end().catch(() => undefined);
    setTimeout(() => void listen(), 5_000);
  };
  client.on('error', retry);
  client.on('end', retry);
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANGE_CHANNEL}`);
    listener = client;
  } catch {
    retry();
  }
};
await listen();

// The public half only (ADR 0017). Older installs without vapid_public.txt still derive it from the
// private key, until init.sh has been run again.
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY_FILE ? vapidPublicFromFile(process.env.VAPID_PUBLIC_KEY_FILE) : vapidFromFile(process.env.VAPID_PRIVATE_KEY_FILE)?.publicKey;

// Owner sign-in through the household's sign-in service (brief Part 8): on when secrets/oidc_client_secret holds the
// client secret. init.sh leaves that file empty, which means off.
const oidcSecretFile = process.env.OIDC_CLIENT_SECRET_FILE;
const oidcSecret = oidcSecretFile && existsSync(oidcSecretFile) ? readFileSync(oidcSecretFile, 'utf8').trim() : '';
const oidc = oidcSecret ? new Oidc(oidcSecret) : undefined;

// The Besu ledger (ADR 0014) writes as the Postgres one does and queues each entry for the chain;
// the worker's signer sends them. The api never talks to the node itself.
const besu = process.env.LEDGER_ADAPTER === 'besu';

const ledger = besu ? besuLedger(db) : postgresLedger(db);
const app = await buildServer({
  db,
  ...(process.env.KIOSK_LAN_URL ? { kioskUrl: process.env.KIOSK_LAN_URL } : {}),
  ledger,
  ...(besu ? { ledgerAdapter: 'besu' as const } : {}),
  changes,
  ...(vapidPublicKey ? { vapidPublicKey } : {}),
  build,
  logLevel: process.env.LOG_LEVEL ?? 'info',
  trustedProxyHops: Number(process.env.TRUSTED_PROXY_HOPS ?? 1),
  notifyChange,
  ...(adguardInUse ? { readQuerylog: (_limit: number, deviceId?: string) => askWorkerForQueries(deviceId), pingAdguard: () => workerReachedAdguard() } : {}),
  ...(existsSync(join(staticDir, 'index.html')) ? { staticDir } : {}),
  ...(oidc ? { oidc } : {}),
});

// The kiosk's own server, on its own port, which Compose publishes on the LAN address only (ADR
// 0015). Its jobs and requests become phone alerts for parents through the worker's alert queue.
const kioskDir = process.env.KIOSK_DIST ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'kiosk', 'dist');
const kioskHost = process.env.KIOSK_LAN_URL ? new URL(process.env.KIOSK_LAN_URL).host : undefined;
const kiosk = await buildKioskServer({
  db,
  ledger,
  // The tablet uses the LAN address; the container's own health check uses localhost.
  ...(kioskHost ? { allowedHosts: [kioskHost, 'localhost:3001', '127.0.0.1:3001'] } : {}),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  notifyChange,
  changes,
  queueAlert: async (job) => {
    try {
      await boss.send('alerts', job, { expireInSeconds: 120 });
    } catch (err) {
      kioskLog('alert_not_queued', (err as Error).message);
    }
  },
  ...(existsSync(join(kioskDir, 'index.html')) ? { staticDir: kioskDir } : {}),
});
function kioskLog(event: string, error: string) {
  kiosk.log.error({ event, error });
}

/** Readiness: the worker had an answer from AdGuard in the last three minutes (any answer counts). */
async function workerReachedAdguard(): Promise<void> {
  const seen = (await readHeartbeat(db))?.adguardSeenAt;
  if (!seen) throw new Error('the worker has not reached AdGuard yet');
  if (Date.now() - seen.getTime() > ADGUARD_STALE_AFTER_MS) throw new Error(`the worker last reached AdGuard at ${seen.toISOString()}`);
}

/**
 * The discovery helper: one device's DNS questions in the last 30 minutes, which the worker reads
 * from AdGuard. Waits up to 15 seconds, then deletes the answer, so no query history is kept.
 */
async function askWorkerForQueries(deviceId: string | undefined): Promise<QueryLogItem[]> {
  if (!deviceId) return [];
  const [req] = await db.insert(discoveryRequests).values({ deviceId }).returning({ id: discoveryRequests.id });
  try {
    await boss.send('discover', { id: req!.id }, { expireInSeconds: 60 });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const [row] = await db.select().from(discoveryRequests).where(eq(discoveryRequests.id, req!.id));
      if (row?.finishedAt) {
        if (row.error) throw new Error(row.error);
        return (row.result ?? []) as QueryLogItem[];
      }
    }
    throw new Error("The worker didn't answer in time. Check AdGuard is reachable, then try again.");
  } finally {
    await db.delete(discoveryRequests).where(eq(discoveryRequests.id, req!.id));
  }
}

const shutdown = async (signal: string) => {
  app.log.info({ event: 'shutdown', signal });
  stopping = true;
  await kiosk.close();
  await app.close();
  await listener?.end().catch(() => undefined);
  await boss.stop({ graceful: true, timeout: 5_000 });
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
await kiosk.listen({ host: '0.0.0.0', port: Number(process.env.KIOSK_PORT ?? 3001) });
app.log.info({ event: 'started', commit: build.commit, schema: build.schema, kioskPort: Number(process.env.KIOSK_PORT ?? 3001) });
