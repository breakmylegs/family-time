import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appliedMigrationCount, latestMigrationTag, migrationsFolder, shippedMigrationCount } from '../src/index.js';
import { testDb, type TestDb } from '../src/testing.js';
import { additiveProblems } from './additive.js';

let handle: TestDb | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

const sqlFiles = () => readdirSync(migrationsFolder).filter((f) => f.endsWith('.sql')).sort();

describe('migrations', () => {
  it('ships one SQL file per journal entry', () => {
    // Floor: an empty folder must fail here, not pass every check below by finding nothing.
    expect(shippedMigrationCount()).toBeGreaterThanOrEqual(1);
    expect(sqlFiles()).toHaveLength(shippedMigrationCount());
    expect(sqlFiles().at(-1)).toBe(`${latestMigrationTag()}.sql`);
  });

  it('applies every migration to an empty database', async () => {
    handle = await testDb({ migrated: false });
    expect(await appliedMigrationCount(handle.db)).toBe(0);
    await handle.close();
    handle = await testDb();
    expect(await appliedMigrationCount(handle.db)).toBe(shippedMigrationCount());
  });

  it('only ever adds, so the previous image still runs after a rollback', () => {
    const files = sqlFiles();
    expect(files.length).toBeGreaterThanOrEqual(1);
    const problems = files.flatMap((f) =>
      additiveProblems(readFileSync(join(migrationsFolder, f), 'utf8')).map((p) => `${f}: ${p}`),
    );
    expect(problems).toEqual([]);
  });
});

describe('additive check', () => {
  // Proves the check bites. If any of these stop being caught, the test above means nothing.
  it.each([
    ['ALTER TABLE "a" DROP COLUMN "b";'],
    ['DROP TABLE "a";'],
    ['ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE integer;'],
    ['ALTER TABLE "a" RENAME COLUMN "b" TO "c";'],
    ['ALTER TABLE "a" ALTER COLUMN "b" SET NOT NULL;'],
    ['ALTER TABLE "a" ADD COLUMN "b" text NOT NULL;'],
    ['DELETE FROM "a";'],
  ])('catches %s', (statement) => {
    expect(additiveProblems(statement)).not.toEqual([]);
  });

  it.each([
    ['CREATE TABLE "a" ("id" smallint PRIMARY KEY NOT NULL);'],
    ['ALTER TABLE "a" ADD COLUMN "b" text NOT NULL DEFAULT \'x\';'],
    ['ALTER TABLE "a" ADD COLUMN "b" text;'],
    ['CREATE INDEX "a_b" ON "a" ("b");'],
  ])('allows %s', (statement) => {
    expect(additiveProblems(statement)).toEqual([]);
  });
});
