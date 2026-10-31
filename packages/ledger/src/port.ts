// The ledger's one interface (brief Part 7). The Postgres adapter is the V2 default; Phase 5's Besu
// adapter implements the same port and must pass the same suite (test/suite.ts).
import type { BonusRule } from '@family-time/domain';

export type Currency = 'TIME' | 'MONEY' | 'FLEX';

/** Minutes, pence and points. */
export interface Balances {
  time: number;
  money: number;
  flex: number;
}

export type EntryKind = 'allowance' | 'award' | 'spend' | 'refund' | 'convert' | 'close' | 'payout' | 'reversal';

export interface LedgerEntry {
  id: string;
  seq: number;
  householdId: string;
  childId: string;
  kind: EntryKind;
  /** Signed changes to the child's balances. */
  time: number;
  money: number;
  flex: number;
  ref: string;
  reason: string;
  data: Record<string, unknown>;
  byPersonId: string | null;
  at: Date;
  prevHash: string;
  hash: string;
  blockNumber: number | null;
  txHash: string | null;
}

/** What every call carries. `ref` makes it idempotent: the same ref again returns the first entry. */
export interface EntryInput {
  ref: string;
  householdId: string;
  childId: string;
  /** For people: "Emptied the dishwasher". */
  reason: string;
  at: Date;
  by?: string | null;
  data?: Record<string, unknown>;
}

export interface Verification {
  ok: boolean;
  checked: number;
  /** The first sequence number that does not fit the chain. */
  brokenAt?: number;
  problem?: string;
}

export class LedgerError extends Error {
  constructor(
    readonly code: 'insufficient' | 'ref_conflict' | 'not_found' | 'not_reversible' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

export interface LedgerPort {
  /** A job paid in money, flex or (capped) time. The cap is the caller's rule; the ledger records. */
  award(input: EntryInput & { currency: Currency; amount: number }): Promise<LedgerEntry>;
  /** The week's TIME, at the reset. */
  allocateAllowance(input: EntryInput & { minutes: number }): Promise<LedgerEntry>;
  /** A planned session or a counted Allow. Refused when the child has not enough TIME. */
  spendTime(input: EntryInput & { minutes: number }): Promise<LedgerEntry>;
  /** Minutes a parent's Block took back from a session, or points a parent chose to refund. */
  refund(input: EntryInput & { currency: Currency; amount: number }): Promise<LedgerEntry>;
  /** Flex points into money or time, at the household's rate (worked out by the caller). */
  convert(input: EntryInput & { points: number; to: 'MONEY' | 'TIME'; amount: number }): Promise<LedgerEntry>;
  /** The week's end: unused TIME becomes the bonus (when on), and the rest of the TIME expires. */
  closeWeek(input: EntryInput & { bonus: BonusRule | null }): Promise<LedgerEntry>;
  /** Pocket money handed over. Refused beyond what is owed. */
  recordPayout(input: EntryInput & { pence: number }): Promise<LedgerEntry>;
  /**
   * Fix a mistake: an exact reversal of one earlier award, conversion or payout. Never a free
   * deduction, and never one that would take a balance below zero.
   */
  reverse(input: EntryInput & { entryRef: string }): Promise<LedgerEntry>;
  balances(householdId: string, childId: string): Promise<Balances>;
  /** Newest first. */
  history(householdId: string, childId: string, options?: { limit?: number; since?: Date; until?: Date }): Promise<LedgerEntry[]>;
  /** Walks the household's chain and recomputes every hash. */
  verify(householdId: string): Promise<Verification>;
}
