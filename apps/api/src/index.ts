import { connectionConfig, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { readBuildInfo } from './build.js';
import { buildServer } from './server.js';

const pool = new pg.Pool({ ...connectionConfig(), max: 10 });
const db = drizzle(pool, { schema }) as unknown as Db;
const build = readBuildInfo();

const app = await buildServer({
  db,
  build,
  logLevel: process.env.LOG_LEVEL ?? 'info',
  trustedProxyHops: Number(process.env.TRUSTED_PROXY_HOPS ?? 1),
});

const shutdown = async (signal: string) => {
  app.log.info({ event: 'shutdown', signal });
  await app.close();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
app.log.info({ event: 'started', commit: build.commit, schema: build.schema });
