// The Postgres ledger (ADR 0012): one append-only table, hash-chained per household. Each append
// runs in a transaction holding the household's advisory lock, so there is one writer at a time
// and every check (enough time left, the earned-time cap, a reference not used, an entry not
// already reversed) sees the latest state.
import { unusedBonus } from '@family-time/domain';
import { ledgerEntries, type Db } from '@family-time/db';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { entryHash, GENESIS } from './chain.js';
import { LedgerError, type Balances, type Currency, type EarnedCap, type EntryInput, type EntryKind, type LedgerEntry, type LedgerPort, type Verification } from './port.js';

type Row = typeof ledgerEntries.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Delta = { time?: number; money?: number; flex?: number; data?: Record<string, unknown> };

function toEntry(r: Row): LedgerEntry {
  return {
    id: r.id,
    seq: r.seq,
    householdId: r.householdId,
    childId: r.childId,
    kind: r.kind,
    time: r.time,
    money: r.money,
    flex: r.flex,
    ref: r.ref,
    reason: r.reason,
    data: r.data as Record<string, unknown>,
    byPersonId: r.byPersonId,
    at: r.at,
    prevHash: r.prevHash,
    hash: r.hash,
    blockNumber: r.blockNumber,
    txHash: r.txHash,
  };
}

/**
 * Whether a parent can reverse this entry to fix a mistake. Awards, conversions and payouts are
 * choices; so is a refund a parent chose to give. Allowances, spending, week closes and the refunds
 * the rules give (minutes a Block took from a session) are not, and cannot be taken back.
 */
export function reversible(e: Pick<LedgerEntry, 'kind' | 'data'>): boolean {
  if (e.kind === 'award' || e.kind === 'convert' || e.kind === 'payout') return true;
  return e.kind === 'refund' && e.data.source === 'chosen';
}

const field: Record<Currency, 'time' | 'money' | 'flex'> = { TIME: 'time', MONEY: 'money', FLEX: 'flex' };

function positive(n: number, what: string) {
  if (!Number.isInteger(n) || n <= 0) throw new LedgerError('invalid', `${what} must be a whole number above zero.`);
}

/** Ids as Postgres stores them, so the hash of what was written matches what is read back. */
const id = (s: string) => s.toLowerCase();

async function balancesIn(q: Db | Tx, householdId: string, childId: string, before?: Date): Promise<Balances> {
  const conditions = [eq(ledgerEntries.householdId, householdId), eq(ledgerEntries.childId, childId)];
  if (before) conditions.push(lt(ledgerEntries.at, before));
  const [row] = await q
    .select({
      time: sql<number>`coalesce(sum(${ledgerEntries.time}), 0)::int`,
      money: sql<number>`coalesce(sum(${ledgerEntries.money}), 0)::int`,
      flex: sql<number>`coalesce(sum(${ledgerEntries.flex}), 0)::int`,
    })
    .from(ledgerEntries)
    .where(and(...conditions));
  return { time: Number(row?.time ?? 0), money: Number(row?.money ?? 0), flex: Number(row?.flex ?? 0) };
}

/** Screen time earned from awards and conversions since `since`, less what was reversed of it. */
async function earnedIn(q: Db | Tx, householdId: string, childId: string, since: Date): Promise<number> {
  const rows = await q
    .select({ kind: ledgerEntries.kind, time: ledgerEntries.time, ref: ledgerEntries.ref, data: ledgerEntries.data })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.householdId, householdId), eq(ledgerEntries.childId, childId), gte(ledgerEntries.at, since), inArray(ledgerEntries.kind, ['award', 'convert', 'reversal'])));
  const earning = new Map(rows.filter((r) => (r.kind === 'award' || r.kind === 'convert') && r.time > 0).map((r) => [r.ref, r.time]));
  let total = [...earning.values()].reduce((n, t) => n + t, 0);
  for (const r of rows) if (r.kind === 'reversal' && earning.has(String((r.data as Record<string, unknown>).reverses))) total += r.time;
  return Math.max(0, total);
}

/** Cuts TIME to what is left of the cap, or refuses when nothing is. */
async function capped(tx: Tx, input: EntryInput, minutes: number, cap: EarnedCap | undefined): Promise<number> {
  if (!cap) return minutes;
  const left = Math.max(0, cap.capMinutes - (await earnedIn(tx, input.householdId, input.childId, cap.since)));
  if (left <= 0) throw new LedgerError('capped', "This week's earned screen time is used up.");
  return Math.min(minutes, left);
}

export function postgresLedger(db: Db): LedgerPort {
  /** Appends one entry under the household's lock, or returns the entry already made for this ref. */
  const append = (raw: EntryInput, kind: EntryKind, compute: (now: Balances, tx: Tx) => Delta | Promise<Delta>): Promise<LedgerEntry> => {
    const input = { ...raw, householdId: id(raw.householdId), childId: id(raw.childId), ...(raw.by ? { by: id(raw.by) } : {}) };
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ledger:${input.householdId}`}))`);
      const existing = (await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.householdId, input.householdId), eq(ledgerEntries.ref, input.ref))))[0];
      if (existing) {
        if (existing.kind !== kind || existing.childId !== input.childId) throw new LedgerError('ref_conflict', 'That was already recorded. Reload to see the latest.');
        return toEntry(existing);
      }
      const now = await balancesIn(tx, input.householdId, input.childId);
      const d = await compute(now, tx);
      const time = d.time ?? 0;
      const money = d.money ?? 0;
      const flex = d.flex ?? 0;
      if (now.time + time < 0) throw new LedgerError('insufficient', `Not enough screen time: ${now.time} minutes left.`);
      if (now.money + money < 0) throw new LedgerError('insufficient', `Not enough pocket money: ${now.money}p owed.`);
      if (now.flex + flex < 0) throw new LedgerError('insufficient', `Not enough flex points: ${now.flex} left.`);

      const last = (await tx.select({ seq: ledgerEntries.seq, hash: ledgerEntries.hash }).from(ledgerEntries).where(eq(ledgerEntries.householdId, input.householdId)).orderBy(desc(ledgerEntries.seq)).limit(1))[0];
      const fields = {
        seq: (last?.seq ?? 0) + 1,
        householdId: input.householdId,
        childId: input.childId,
        kind,
        time,
        money,
        flex,
        ref: input.ref,
        reason: input.reason,
        data: { ...(input.data ?? {}), ...(d.data ?? {}) },
        byPersonId: input.by ?? null,
        // Millisecond precision, the same on the way back from Postgres, so the hash checks out.
        at: new Date(input.at.getTime()),
      };
      const prevHash = last?.hash ?? GENESIS;
      const [row] = await tx
        .insert(ledgerEntries)
        .values({ ...fields, prevHash, hash: entryHash(prevHash, fields) })
        .returning();
      return toEntry(row!);
    });
  };

  return {
    award: async (input) => {
      positive(input.amount, 'An award');
      return append(input, 'award', async (_now, tx) => {
        const amount = input.currency === 'TIME' ? await capped(tx, input, input.amount, input.cap) : input.amount;
        return { [field[input.currency]]: amount, data: { currency: input.currency, ...(amount < input.amount ? { asked: input.amount } : {}) } };
      });
    },
    allocateAllowance: async (input) => {
      if (!Number.isInteger(input.minutes) || input.minutes < 0) throw new LedgerError('invalid', 'An allowance is a whole number of minutes.');
      return append(input, 'allowance', () => ({ time: input.minutes }));
    },
    spendTime: async (input) => {
      positive(input.minutes, 'Time spent');
      return append(input, 'spend', () => ({ time: -input.minutes }));
    },
    refund: async (input) => {
      positive(input.amount, 'A refund');
      return append(input, 'refund', () => ({ [field[input.currency]]: input.amount, data: { currency: input.currency, source: input.chosen ? 'chosen' : 'rule' } }));
    },
    convert: async (input) => {
      positive(input.points, 'Points to convert');
      positive(input.amount, 'What the points become');
      return append(input, 'convert', async (_now, tx) => {
        if (input.to === 'TIME') {
          const allowed = await capped(tx, input, input.amount, input.cap);
          if (allowed < input.amount) throw new LedgerError('capped', `Only ${allowed} minutes of this week's earned screen time are left.`);
        }
        return { flex: -input.points, [input.to === 'MONEY' ? 'money' : 'time']: input.amount, data: { to: input.to } };
      });
    },
    closeWeek: (input) =>
      append(input, 'close', async (now, tx) => {
        // What was left at the boundary, not now: time given after the reset belongs to the new week.
        const atBoundary = input.asOf ? await balancesIn(tx, id(input.householdId), id(input.childId), input.asOf) : now;
        const left = Math.max(0, Math.min(atBoundary.time, now.time));
        const bonus = input.bonus ? unusedBonus(left, input.bonus) : 0;
        return { time: -left, money: bonus, data: { minutesLeft: left, bonusPence: bonus } };
      }),
    recordPayout: async (input) => {
      positive(input.pence, 'A payout');
      return append(input, 'payout', () => ({ money: -input.pence }));
    },
    reverse: (input) =>
      append(input, 'reversal', async (_now, tx) => {
        const hh = id(input.householdId);
        const original = (await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.householdId, hh), eq(ledgerEntries.ref, input.entryRef))))[0];
        if (!original || original.childId !== id(input.childId)) throw new LedgerError('not_found', 'There is no such entry for this child.');
        if (!reversible(toEntry(original))) throw new LedgerError('not_reversible', 'Only an award, a conversion, a payout or points you chose to give back can be reversed.');
        // Once only, whichever way it comes: Undo or Fix a mistake.
        const done = await tx
          .select({ ref: ledgerEntries.ref })
          .from(ledgerEntries)
          .where(and(eq(ledgerEntries.householdId, hh), eq(ledgerEntries.kind, 'reversal'), sql`${ledgerEntries.data}->>'reverses' = ${input.entryRef}`));
        if (done.length) throw new LedgerError('not_reversible', 'That has already been put right.');
        return { time: -original.time, money: -original.money, flex: -original.flex, data: { reverses: original.ref } };
      }),
    balances: (householdId, childId) => balancesIn(db, id(householdId), id(childId)),
    earnedTime: (householdId, childId, since) => earnedIn(db, id(householdId), id(childId), since),
    history: async (householdId, childId, options = {}) => {
      const conditions = [eq(ledgerEntries.householdId, id(householdId)), eq(ledgerEntries.childId, id(childId))];
      if (options.since) conditions.push(gte(ledgerEntries.at, options.since));
      if (options.until) conditions.push(lt(ledgerEntries.at, options.until));
      const rows = await db
        .select()
        .from(ledgerEntries)
        .where(and(...conditions))
        .orderBy(desc(ledgerEntries.seq))
        .limit(options.limit ?? 500);
      return rows.map(toEntry);
    },
    verify: async (householdId): Promise<Verification> => {
      const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.householdId, id(householdId))).orderBy(asc(ledgerEntries.seq));
      let prev = GENESIS;
      for (const [i, r] of rows.entries()) {
        const fail = (problem: string): Verification => ({ ok: false, checked: i, brokenAt: r.seq, problem });
        if (r.seq !== i + 1) return fail(`Entry ${i + 1} is missing.`);
        if (r.prevHash !== prev) return fail(`Entry ${r.seq} does not follow entry ${r.seq - 1}.`);
        const recomputed = entryHash(prev, {
          seq: r.seq,
          householdId: r.householdId,
          childId: r.childId,
          kind: r.kind,
          time: r.time,
          money: r.money,
          flex: r.flex,
          ref: r.ref,
          reason: r.reason,
          data: r.data as Record<string, unknown>,
          byPersonId: r.byPersonId,
          at: r.at,
        });
        if (recomputed !== r.hash) return fail(`Entry ${r.seq} has been changed.`);
        prev = r.hash;
      }
      return { ok: true, checked: rows.length, ...(rows.length ? { head: { seq: rows[rows.length - 1]!.seq, hash: rows[rows.length - 1]!.hash } } : {}) };
    },
  };
}
