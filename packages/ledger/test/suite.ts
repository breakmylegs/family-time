// The ledger's contract, written once against the port. The Postgres adapter runs it on PGlite here
// and on real Postgres in the deploy's test stage; the Besu adapter must pass it in Phase 5.
import { describe, expect, it } from 'vitest';
import { LedgerError, type LedgerPort } from '../src/index.js';

export interface LedgerFixture {
  ledger: LedgerPort;
  householdId: string;
  childId: string;
  otherChildId: string;
  close: () => Promise<void>;
}

const AT = new Date('2026-10-25T18:00:00Z');
let n = 0;
const ref = (what: string) => `${what}:${process.pid}:${Date.now()}:${++n}`;

export function ledgerSuite(name: string, make: () => Promise<LedgerFixture>) {
  describe(`${name}: the ledger contract`, () => {
    const withLedger = (fn: (f: LedgerFixture) => Promise<void>) => async () => {
      const f = await make();
      try {
        await fn(f);
      } finally {
        await f.close();
      }
    };
    const base = (f: LedgerFixture, what: string) => ({ ref: ref(what), householdId: f.householdId, childId: f.childId, reason: what, at: AT });

    it(
      'gives the allowance, spends it, and keeps each child apart',
      withLedger(async (f) => {
        await f.ledger.allocateAllowance({ ...base(f, 'allowance'), minutes: 420 });
        await f.ledger.spendTime({ ...base(f, 'session'), minutes: 30 });
        expect(await f.ledger.balances(f.householdId, f.childId)).toEqual({ time: 390, money: 0, flex: 0 });
        expect(await f.ledger.balances(f.householdId, f.otherChildId)).toEqual({ time: 0, money: 0, flex: 0 });
      }),
    );

    it(
      'refuses to spend more time than is left, and changes nothing',
      withLedger(async (f) => {
        await f.ledger.allocateAllowance({ ...base(f, 'allowance'), minutes: 30 });
        await expect(f.ledger.spendTime({ ...base(f, 'session'), minutes: 60 })).rejects.toMatchObject({ code: 'insufficient' });
        expect((await f.ledger.balances(f.householdId, f.childId)).time).toBe(30);
      }),
    );

    it(
      'is idempotent on the reference, and refuses a reference reused for something else',
      withLedger(async (f) => {
        const input = { ...base(f, 'award'), currency: 'MONEY' as const, amount: 50 };
        const first = await f.ledger.award(input);
        const again = await f.ledger.award(input);
        expect(again.id).toBe(first.id);
        expect((await f.ledger.balances(f.householdId, f.childId)).money).toBe(50);
        await expect(f.ledger.spendTime({ ...input, minutes: 10 })).rejects.toBeInstanceOf(LedgerError);
      }),
    );

    it(
      'closes the week: unused time becomes the bonus, the rest expires',
      withLedger(async (f) => {
        await f.ledger.allocateAllowance({ ...base(f, 'allowance'), minutes: 420 });
        await f.ledger.spendTime({ ...base(f, 'session'), minutes: 345 });
        const closed = await f.ledger.closeWeek({ ...base(f, 'close'), bonus: { pencePerBlock: 10, weeklyCapPence: 100 } });
        expect(closed).toMatchObject({ kind: 'close', time: -75, money: 20, data: { minutesLeft: 75, bonusPence: 20 } });
        expect(await f.ledger.balances(f.householdId, f.childId)).toEqual({ time: 0, money: 20, flex: 0 });
        // With the bonus off (an earlier pilot phase) the time simply expires.
        await f.ledger.allocateAllowance({ ...base(f, 'allowance'), minutes: 60 });
        await f.ledger.closeWeek({ ...base(f, 'close'), bonus: null });
        expect(await f.ledger.balances(f.householdId, f.childId)).toEqual({ time: 0, money: 20, flex: 0 });
      }),
    );

    it(
      'converts flex points and records payouts, never beyond what there is',
      withLedger(async (f) => {
        await f.ledger.award({ ...base(f, 'job'), currency: 'FLEX', amount: 40 });
        await f.ledger.convert({ ...base(f, 'convert'), points: 30, to: 'MONEY', amount: 30 });
        expect(await f.ledger.balances(f.householdId, f.childId)).toEqual({ time: 0, money: 30, flex: 10 });
        await expect(f.ledger.convert({ ...base(f, 'convert'), points: 11, to: 'TIME', amount: 11 })).rejects.toMatchObject({ code: 'insufficient' });
        await expect(f.ledger.recordPayout({ ...base(f, 'payout'), pence: 31 })).rejects.toMatchObject({ code: 'insufficient' });
        await f.ledger.recordPayout({ ...base(f, 'payout'), pence: 30 });
        expect((await f.ledger.balances(f.householdId, f.childId)).money).toBe(0);
      }),
    );

    it(
      'fixes a mistake only by reversing one entry exactly, and never below zero',
      withLedger(async (f) => {
        const award = await f.ledger.award({ ...base(f, 'job'), currency: 'MONEY', amount: 50 });
        const allowance = await f.ledger.allocateAllowance({ ...base(f, 'allowance'), minutes: 60 });
        await expect(f.ledger.reverse({ ...base(f, 'fix'), entryRef: allowance.ref })).rejects.toMatchObject({ code: 'not_reversible' });
        const fix = await f.ledger.reverse({ ...base(f, 'fix'), entryRef: award.ref });
        expect(fix).toMatchObject({ kind: 'reversal', money: -50, data: { reverses: award.ref } });
        const paid = await f.ledger.award({ ...base(f, 'job'), currency: 'MONEY', amount: 20 });
        await f.ledger.recordPayout({ ...base(f, 'payout'), pence: 20 });
        await expect(f.ledger.reverse({ ...base(f, 'fix'), entryRef: paid.ref })).rejects.toMatchObject({ code: 'insufficient' });
      }),
    );

    it(
      'reverses an entry once only, whichever way it comes, and never a refund the rules gave',
      withLedger(async (f) => {
        await f.ledger.award({ ...base(f, 'other job'), currency: 'MONEY', amount: 100 });
        const award = await f.ledger.award({ ...base(f, 'job'), currency: 'MONEY', amount: 50 });
        await f.ledger.reverse({ ...base(f, 'undo'), entryRef: award.ref });
        await expect(f.ledger.reverse({ ...base(f, 'fix'), entryRef: award.ref })).rejects.toMatchObject({ code: 'not_reversible' });
        expect((await f.ledger.balances(f.householdId, f.childId)).money).toBe(100);

        const ruled = await f.ledger.refund({ ...base(f, 'session refund'), currency: 'TIME', amount: 20 });
        await expect(f.ledger.reverse({ ...base(f, 'fix'), entryRef: ruled.ref })).rejects.toMatchObject({ code: 'not_reversible' });
        const chosen = await f.ledger.refund({ ...base(f, 'points back'), currency: 'FLEX', amount: 10, chosen: true });
        await f.ledger.reverse({ ...base(f, 'fix'), entryRef: chosen.ref });
        expect((await f.ledger.balances(f.householdId, f.childId)).flex).toBe(0);
      }),
    );

    it(
      'never takes back screen time once its week has closed, and the rules give back only minutes',
      withLedger(async (f) => {
        const job = await f.ledger.award({ ...base(f, 'job in time'), currency: 'TIME', amount: 30 });
        const pay = await f.ledger.award({ ...base(f, 'job in money'), currency: 'MONEY', amount: 50 });
        await f.ledger.closeWeek({ ...base(f, 'close'), bonus: null });
        await f.ledger.allocateAllowance({ ...base(f, 'next week'), minutes: 420 });
        // Taking the 30 minutes now would cut the new week's agreed allowance.
        await expect(f.ledger.reverse({ ...base(f, 'fix time'), entryRef: job.ref })).rejects.toMatchObject({ code: 'not_reversible' });
        await f.ledger.reverse({ ...base(f, 'fix money'), entryRef: pay.ref });
        expect(await f.ledger.balances(f.householdId, f.childId)).toEqual({ time: 420, money: 0, flex: 0 });
        await expect(f.ledger.refund({ ...base(f, 'money back'), currency: 'MONEY', amount: 50 })).rejects.toMatchObject({ code: 'invalid' });
      }),
    );

    it(
      'keeps earned screen time under the cap, even when approvals race, and frees what is reversed',
      withLedger(async (f) => {
        const cap = { capMinutes: 63, since: new Date(AT.getTime() - 3_600_000) };
        const both = await Promise.all([
          f.ledger.award({ ...base(f, 'reading'), currency: 'TIME', amount: 45, cap }),
          f.ledger.award({ ...base(f, 'garden'), currency: 'TIME', amount: 45, cap }),
        ]);
        expect(both.map((x) => x.time).sort((a, b) => a - b)).toEqual([18, 45]);
        expect(await f.ledger.earnedTime(f.householdId, f.childId, cap.since)).toBe(63);
        await expect(f.ledger.award({ ...base(f, 'more'), currency: 'TIME', amount: 5, cap })).rejects.toMatchObject({ code: 'capped' });
        await f.ledger.award({ ...base(f, 'flex job'), currency: 'FLEX', amount: 10 });
        await expect(f.ledger.convert({ ...base(f, 'convert'), points: 5, to: 'TIME', amount: 5, cap })).rejects.toMatchObject({ code: 'capped' });
        await f.ledger.reverse({ ...base(f, 'undo'), entryRef: both[0]!.ref });
        expect(await f.ledger.earnedTime(f.householdId, f.childId, cap.since)).toBe(63 - both[0]!.time);
      }),
    );

    it(
      'closes the week as it stood at the boundary, so time given after the reset belongs to the new week',
      withLedger(async (f) => {
        const boundary = new Date(AT.getTime() + 7 * 86_400_000);
        await f.ledger.allocateAllowance({ ...base(f, 'allowance'), minutes: 60 });
        await f.ledger.refund({ ...base(f, 'late refund'), at: new Date(boundary.getTime() + 60_000), currency: 'TIME', amount: 30 });
        const closed = await f.ledger.closeWeek({ ...base(f, 'close'), at: boundary, asOf: boundary, bonus: { pencePerBlock: 10, weeklyCapPence: 100 } });
        expect(closed).toMatchObject({ time: -60, money: 20 });
        expect((await f.ledger.balances(f.householdId, f.childId)).time).toBe(30);
      }),
    );

    it(
      'rejects amounts that are not whole and positive',
      withLedger(async (f) => {
        await expect(f.ledger.award({ ...base(f, 'job'), currency: 'MONEY', amount: 0 })).rejects.toMatchObject({ code: 'invalid' });
        await expect(f.ledger.spendTime({ ...base(f, 'session'), minutes: 1.5 })).rejects.toMatchObject({ code: 'invalid' });
      }),
    );

    it(
      'keeps every entry in one unbroken chain, newest first in the history, even when writes race',
      withLedger(async (f) => {
        await Promise.all(Array.from({ length: 12 }, (_, i) => f.ledger.award({ ...base(f, `race${i}`), currency: 'FLEX', amount: 1 })));
        await f.ledger.award({ ...base(f, 'other child'), childId: f.otherChildId, currency: 'FLEX', amount: 5 });
        expect((await f.ledger.balances(f.householdId, f.childId)).flex).toBe(12);
        const history = await f.ledger.history(f.householdId, f.childId);
        expect(history).toHaveLength(12);
        expect(history[0]!.seq).toBeGreaterThan(history[11]!.seq);
        expect(await f.ledger.verify(f.householdId)).toMatchObject({ ok: true, checked: 13, head: { seq: 13 } });
      }),
    );
  });
}
