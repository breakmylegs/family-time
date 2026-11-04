import { AdGuard } from '@family-time/adguard-client';
import { connectionConfig, readSecret, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { besuLedger, postgresLedger } from '@family-time/ledger';
import { CHANGE_CHANNEL, vapidFromFile, vapidPublicFromFile } from '@family-time/notify';
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

// Read-only, for the discovery helper. The api never writes to AdGuard.
const adguardPassword = readSecret('ADGUARD_PASSWORD');
const adguard = adguardPassword
  ? new AdGuard({ baseUrl: process.env.ADGUARD_URL ?? 'http://adguard:3000', username: process.env.ADGUARD_USER ?? 'familytime', password: adguardPassword })
  : undefined;

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
  ...(adguard ? { readQuerylog: async (limit: number) => (await adguard.querylog({ limit })).data } : {}),
  ...(existsSync(join(staticDir, 'index.html')) ? { staticDir } : {}),
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
