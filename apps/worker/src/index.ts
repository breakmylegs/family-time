import { AdGuard } from '@family-time/adguard-client';
import { connectionConfig, readSecret, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { jsonLog, startWorker } from './worker.js';

const log = jsonLog('worker', process.env.LOG_LEVEL ?? 'info');
const config = connectionConfig();
const pool = new pg.Pool({ ...config, max: 5 });
const db = drizzle(pool, { schema }) as unknown as Db;
const boss = new PgBoss({ ...config, max: 5 } as ConstructorParameters<typeof PgBoss>[0]);

// AdGuard's admin API, on the internal network. The password is made by init.sh and set in
// AdGuard by ./scripts/ft.sh adguard-setup; until then the control jobs wait.
const adguardPassword = readSecret('ADGUARD_PASSWORD');
const adguard = adguardPassword
  ? new AdGuard({ baseUrl: process.env.ADGUARD_URL ?? 'http://adguard:3000', username: process.env.ADGUARD_USER ?? 'familytime', password: adguardPassword })
  : undefined;

const worker = await startWorker({ boss, db, commit: process.env.GIT_COMMIT || 'dev', now: () => new Date(), log, ...(adguard ? { adguard } : {}) });

const shutdown = async (signal: string) => {
  log('info', 'shutdown', { signal });
  await worker.stop();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
