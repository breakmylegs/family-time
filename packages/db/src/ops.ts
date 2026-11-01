// Operations state kept as household settings (Phase 8, ADR 0017): the last backup, written by
// backup.sh through the command line, and maintenance mode, switched by the owner on the server.
import { and, eq } from 'drizzle-orm';
import { households, settings } from './schema.js';
import type { Db } from './types.js';

export const SETTING_LAST_BACKUP = 'last_backup';
export const SETTING_MAINTENANCE = 'maintenance';

export interface LastBackup {
  /** When the run finished. */
  at: string;
  ok: boolean;
  /** When the last good run finished; the same as `at` when this one was good. */
  lastOkAt: string | null;
  /** The size of the database dump, in bytes. */
  bytes: number | null;
  snapshot: string | null;
  problem: string | null;
}

export interface Maintenance {
  on: boolean;
  message: string | null;
  since: string | null;
}

async function read<T>(db: Db, householdId: string, key: string): Promise<T | null> {
  const row = (await db.select({ value: settings.value }).from(settings).where(and(eq(settings.householdId, householdId), eq(settings.key, key))))[0];
  return (row?.value as T | undefined) ?? null;
}

async function write(db: Db, householdId: string, key: string, value: unknown, now: Date) {
  await db
    .insert(settings)
    .values({ householdId, key, value, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.householdId, settings.key], set: { value, updatedAt: now } });
}

export const lastBackup = (db: Db, householdId: string) => read<LastBackup>(db, householdId, SETTING_LAST_BACKUP);

export async function maintenance(db: Db, householdId: string): Promise<Maintenance> {
  return (await read<Maintenance>(db, householdId, SETTING_MAINTENANCE)) ?? { on: false, message: null, since: null };
}

/** Records a backup run for every household (one per install in V1), keeping the last good time. */
export async function recordBackup(db: Db, run: { ok: boolean; bytes: number | null; snapshot: string | null; problem: string | null }, now: Date): Promise<LastBackup[]> {
  const out: LastBackup[] = [];
  for (const h of await db.select({ id: households.id }).from(households)) {
    const before = await lastBackup(db, h.id);
    const value: LastBackup = { at: now.toISOString(), ok: run.ok, lastOkAt: run.ok ? now.toISOString() : (before?.lastOkAt ?? null), bytes: run.bytes, snapshot: run.snapshot, problem: run.ok ? null : run.problem };
    await write(db, h.id, SETTING_LAST_BACKUP, value, now);
    out.push(value);
  }
  return out;
}

export async function setMaintenance(db: Db, input: { on: boolean; message: string | null }, now: Date): Promise<void> {
  for (const h of await db.select({ id: households.id }).from(households)) {
    await write(db, h.id, SETTING_MAINTENANCE, { on: input.on, message: input.on ? input.message : null, since: input.on ? now.toISOString() : null } satisfies Maintenance, now);
  }
}
