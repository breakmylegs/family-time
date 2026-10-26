// One-shot migrate runner. The Compose `migrate` service runs this, then exits.
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { connectionConfig } from './connection.js';
import { latestMigrationTag, migrationsFolder } from './migrations.js';

const log = (level: string, event: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), level, app: 'family-time', service: 'migrate', event, ...extra }));

const pool = new pg.Pool({ ...connectionConfig(), max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder });
  log('info', 'migrated', { schema: latestMigrationTag() });
} catch (err) {
  log('error', 'migrate_failed', { error: String(err) });
  process.exitCode = 1;
} finally {
  await pool.end();
}
