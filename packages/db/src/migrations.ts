import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { Db } from './types.js';

/** The migrations folder sits in the package root, beside src/ and dist/. */
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

interface Journal {
  entries: { idx: number; tag: string }[];
}

function journal(): Journal {
  return JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as Journal;
}

/** Tag of the newest migration this build ships, for example `0000_foundations`. */
export function latestMigrationTag(): string {
  const last = journal().entries.at(-1);
  if (!last) throw new Error(`No migrations in ${migrationsFolder}`);
  return last.tag;
}

export function shippedMigrationCount(): number {
  return journal().entries.length;
}

/** How many migrations the database has applied. Zero when Drizzle's table does not exist yet. */
export async function appliedMigrationCount(db: Db): Promise<number> {
  const exists = await db.execute(sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`);
  if (!rowsOf<{ present: boolean }>(exists)[0]?.present) return 0;
  const count = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
  return rowsOf<{ n: number }>(count)[0]?.n ?? 0;
}

/** node-postgres and PGlite both return `{ rows }`. */
function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}
