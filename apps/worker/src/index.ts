import { connectionConfig, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { jsonLog, startWorker } from './worker.js';

const log = jsonLog('worker', process.env.LOG_LEVEL ?? 'info');
const config = connectionConfig();
const pool = new pg.Pool({ ...config, max: 5 });
const db = drizzle(pool, { schema }) as unknown as Db;
const boss = new PgBoss({ ...config, max: 5 } as ConstructorParameters<typeof PgBoss>[0]);

const worker = await startWorker({ boss, db, commit: process.env.GIT_COMMIT || 'dev', now: () => new Date(), log });

const shutdown = async (signal: string) => {
  log('info', 'shutdown', { signal });
  await worker.stop();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
