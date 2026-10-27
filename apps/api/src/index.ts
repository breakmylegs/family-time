import { AdGuard } from '@family-time/adguard-client';
import { connectionConfig, readSecret, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { readBuildInfo } from './build.js';
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

const app = await buildServer({
  db,
  build,
  logLevel: process.env.LOG_LEVEL ?? 'info',
  trustedProxyHops: Number(process.env.TRUSTED_PROXY_HOPS ?? 1),
  notifyChange,
  ...(adguard ? { readQuerylog: async (limit: number) => (await adguard.querylog({ limit })).data } : {}),
  ...(existsSync(join(staticDir, 'index.html')) ? { staticDir } : {}),
});

const shutdown = async (signal: string) => {
  app.log.info({ event: 'shutdown', signal });
  await app.close();
  await boss.stop({ graceful: true, timeout: 5_000 });
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
app.log.info({ event: 'started', commit: build.commit, schema: build.schema });
