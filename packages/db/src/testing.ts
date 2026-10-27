// Test helpers. Imported by tests only, through `@family-time/db/testing`. PGlite is a dev
// dependency, so nothing in the runtime image may import this file.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrationsFolder } from './migrations.js';
import * as schema from './schema.js';
import type { Db } from './types.js';

export interface TestDb {
  db: Db;
  client: PGlite;
  close: () => Promise<void>;
}

/** A fresh Postgres (in memory, or in `dataDir`), optionally with every migration applied. */
export async function testDb(options: { migrated?: boolean; dataDir?: string } = {}): Promise<TestDb> {
  const client = options.dataDir ? new PGlite(options.dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  if (options.migrated ?? true) await migrate(db, { migrationsFolder });
  // Safe to call twice: tests close the database early to simulate it going away.
  return { db: db as unknown as Db, client, close: async () => (client.closed ? undefined : client.close()) };
}
