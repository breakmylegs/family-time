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
  /** The last entry, so a later check can tell if entries were removed from the end. */
  head?: { seq: number; hash: string };
}

export class LedgerError extends Error {
  constructor(
    readonly code: 'insufficient' | 'ref_conflict' | 'not_found' | 'not_reversible' | 'invalid' | 'capped',
    message: string,
  ) {
    super(message);
  }
}

/**
 * The cap on screen time earned from jobs and flex this week (ADR 0013), checked under the ledger's
 * lock so two approvals at once cannot both fit under it.
 */
export interface EarnedCap {
  capMinutes: number;
  /** The start of the week the cap is for. */
  since: Date;
}

export interface LedgerPort {
  /**
   * A job paid in money, flex or time. With `cap`, TIME is cut to what is left of it; nothing left
   * is refused with code `capped`.
   */
  award(input: EntryInput & { currency: Currency; amount: number; cap?: EarnedCap }): Promise<LedgerEntry>;
  /** The week's TIME, at the reset. */
  allocateAllowance(input: EntryInput & { minutes: number }): Promise<LedgerEntry>;
  /** A planned session or a counted Allow. Refused when the child has not enough TIME. */
  spendTime(input: EntryInput & { minutes: number }): Promise<LedgerEntry>;
  /**
   * Minutes a parent's Block took back from a session (the rules give these, and they cannot be
   * reversed), or points a parent chose to give back (`chosen`, and those can be).
   */
  refund(input: EntryInput & { currency: Currency; amount: number; chosen?: boolean }): Promise<LedgerEntry>;
  /** Flex points into money or time, at the household's rate (worked out by the caller). TIME respects `cap`. */
  convert(input: EntryInput & { points: number; to: 'MONEY' | 'TIME'; amount: number; cap?: EarnedCap }): Promise<LedgerEntry>;
  /**
   * The week's end: unused TIME becomes the bonus (when on), and the rest of the TIME expires.
   * Counted from entries before `asOf` (the boundary), so time given after the reset is untouched.
   */
  closeWeek(input: EntryInput & { bonus: BonusRule | null; asOf?: Date }): Promise<LedgerEntry>;
  /** Pocket money handed over. Refused beyond what is owed. */
  recordPayout(input: EntryInput & { pence: number }): Promise<LedgerEntry>;
  /**
   * Fix a mistake: an exact reversal of one earlier award, conversion, payout or chosen refund, once
   * only. Never a free deduction, and never one that would take a balance below zero.
   */
  reverse(input: EntryInput & { entryRef: string }): Promise<LedgerEntry>;
  balances(householdId: string, childId: string): Promise<Balances>;
  /** Screen time earned from jobs and flex since a moment, less any of it reversed. */
  earnedTime(householdId: string, childId: string, since: Date): Promise<number>;
  /** Newest first. */
  history(householdId: string, childId: string, options?: { limit?: number; since?: Date; until?: Date }): Promise<LedgerEntry[]>;
  /** Walks the household's chain and recomputes every hash. */
  verify(householdId: string): Promise<Verification>;
}
