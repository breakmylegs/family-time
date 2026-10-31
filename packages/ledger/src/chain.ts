// The hash chain: canonical JSON (sorted keys, no spaces) and SHA-256 over the previous hash and
// the entry. Small and our own, so the Besu indexer and the nightly check compute it the same way.
import { createHash } from 'node:crypto';

export const GENESIS = '0'.repeat(64);

/** JSON with object keys sorted at every level, Dates as ISO strings, and no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('The ledger holds whole numbers only');
  return JSON.stringify(value ?? null);
}

/** The fields an entry's hash covers: everything about the event, nothing about where it is stored. */
export interface HashedFields {
  seq: number;
  householdId: string;
  childId: string;
  kind: string;
  time: number;
  money: number;
  flex: number;
  ref: string;
  reason: string;
  data: Record<string, unknown>;
  byPersonId: string | null;
  at: Date;
}

export function entryHash(prevHash: string, fields: HashedFields): string {
  return createHash('sha256').update(prevHash).update(canonicalJson(fields)).digest('hex');
}
