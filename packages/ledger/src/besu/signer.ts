// The signer (brief Part 7, ADR 0014): one pass sends the queue's next batch to the chain, in
// order, and settles what was sent before. The worker runs it on one pg-boss queue with
// concurrency 1 and a singleton key, so there is only ever one signer.
//
// A pass first settles every sent transaction: mined, reverted (failed), or dropped by the node
// (back to pending, found with the pending nonce count, which is also how a restart reconciles).
// Only when nothing is in flight does it send more, so the chain always sees each household's
// entries in order. A failed transaction stops all sending: Postgres and the chain disagree, and
// the owner is told rather than the signer carrying on past it.
import { ledgerEntries, ledgerTx, loadRates, type Db, type Rates } from '@family-time/db';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Hex } from 'viem';
import { callFor, householdKey } from './calls.js';
import type { ChainClient } from './client.js';
import { activeContract, queueReplay } from './ledger.js';
import { TOKEN } from './abi.js';

export interface SignerResult {
  sent: number;
  mined: number;
  failed: number;
  /** Sent and not mined yet. */
  waiting: number;
  /** Pending, not sent yet. */
  queued: number;
  /** Set when a failed transaction has stopped the signer. */
  stopped?: { entryRef: string; reason: string };
}

export interface SignerOptions {
  /** Transactions per pass. All of them usually land in the next block. */
  batch?: number;
  /** Told once, when a transaction fails. */
  onFailed?: (f: { entryRef: string; householdId: string; reason: string }) => Promise<void>;
}

const empty = (): SignerResult => ({ sent: 0, mined: 0, failed: 0, waiting: 0, queued: 0 });

export async function signerPass(db: Db, chain: ChainClient, options: SignerOptions = {}): Promise<SignerResult> {
  const result = empty();
  const c = await activeContract(db);
  if (!c || c.address !== chain.contract.toLowerCase()) return result;
  const now = () => new Date();

  // 1. Settle what was sent.
  const sent = await db.select().from(ledgerTx).where(and(eq(ledgerTx.contractId, c.id), eq(ledgerTx.status, 'sent'))).orderBy(asc(ledgerTx.position));
  let nodeNonce: number | undefined;
  for (const t of sent) {
    const r = await chain.receipt(t.txHash as Hex);
    if (r?.status === 'success') {
      await db.update(ledgerTx).set({ status: 'mined', blockNumber: r.blockNumber, error: null, updatedAt: now() }).where(eq(ledgerTx.id, t.id));
      result.mined++;
    } else if (r?.status === 'reverted') {
      const reason = r.reason ?? 'reverted on chain';
      await db.update(ledgerTx).set({ status: 'failed', blockNumber: r.blockNumber, error: reason, updatedAt: now() }).where(eq(ledgerTx.id, t.id));
      result.failed++;
      const entry = (await db.select({ ref: ledgerEntries.ref, householdId: ledgerEntries.householdId }).from(ledgerEntries).where(eq(ledgerEntries.id, t.entryId)))[0];
      await options.onFailed?.({ entryRef: entry?.ref ?? t.entryId, householdId: entry?.householdId ?? '', reason });
    } else {
      // Not mined. If the node no longer counts its nonce, it was dropped: send it again.
      nodeNonce ??= await chain.pendingNonce();
      if (t.nonce !== null && nodeNonce <= t.nonce) {
        await db.update(ledgerTx).set({ status: 'pending', nonce: null, txHash: null, updatedAt: now() }).where(eq(ledgerTx.id, t.id));
      } else {
        result.waiting++;
      }
    }
  }

  const failed = (
    await db
      .select({ ref: ledgerEntries.ref, error: ledgerTx.error })
      .from(ledgerTx)
      .innerJoin(ledgerEntries, eq(ledgerEntries.id, ledgerTx.entryId))
      .where(and(eq(ledgerTx.contractId, c.id), eq(ledgerTx.status, 'failed')))
      .orderBy(asc(ledgerTx.position))
      .limit(1)
  )[0];
  const [{ queued } = { queued: 0 }] = await db.select({ queued: count() }).from(ledgerTx).where(and(eq(ledgerTx.contractId, c.id), eq(ledgerTx.status, 'pending')));
  result.queued = Number(queued);
  if (failed) return { ...result, stopped: { entryRef: failed.ref, reason: failed.error ?? 'reverted on chain' } };
  if (result.waiting) return result;

  // 2. Catch up any entry written while a contract was being activated (almost never anything).
  const [{ entries } = { entries: 0 }] = await db.select({ entries: count() }).from(ledgerEntries);
  const [{ onChain } = { onChain: 0 }] = await db.select({ onChain: count() }).from(ledgerTx).where(eq(ledgerTx.contractId, c.id));
  if (Number(entries) > Number(onChain)) result.queued += await queueReplay(db, c.id);

  // 3. Send the next batch, in order.
  const batch = await db
    .select({ tx: ledgerTx, entry: ledgerEntries })
    .from(ledgerTx)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, ledgerTx.entryId))
    .where(and(eq(ledgerTx.contractId, c.id), eq(ledgerTx.status, 'pending')))
    .orderBy(asc(ledgerTx.position))
    .limit(options.batch ?? 50);
  // The chain checks conversions and bonuses against its own copy of each household's settings,
  // which the signer keeps in step from the settings themselves, never from the entry being
  // checked: a RateSet or BonusRuleSet event each time one changes. What this batch has set
  // already is remembered, so it is set once.
  const settings = new Map<string, Rates>();
  const chainCopy = new Map<string, bigint>();
  const ratesOf = async (householdId: string) => settings.get(householdId) ?? settings.set(householdId, await loadRates(db, householdId)).get(householdId)!;
  for (const { tx: t, entry: e } of batch) {
    const call = callFor({ ...e, data: e.data as Record<string, unknown> });
    try {
      if (call.fn === 'convert') {
        const household = householdKey(e.householdId);
        const toId = call.args[4];
        const r = await ratesOf(e.householdId);
        const each = BigInt(toId === TOKEN.TIME ? r.flexMinutes : r.flexPence);
        const k = `rate:${household}:${toId}`;
        if ((chainCopy.get(k) ?? (await chain.rate(household, toId))) !== each) await chain.send({ fn: 'setRate', args: [household, toId, each] });
        chainCopy.set(k, each);
      }
      if (call.fn === 'closeWeek') {
        const household = householdKey(e.householdId);
        const r = await ratesOf(e.householdId);
        const per = BigInt(r.bonus.pencePerBlock);
        const cap = BigInt(r.bonus.weeklyCapPence);
        const k = `bonus:${household}`;
        const now = chainCopy.get(k) ?? (await chain.bonusRule(household).then((b) => (b.pencePerBlock === per && b.weeklyCapPence === cap ? -1n : 0n)));
        if (now !== -1n) await chain.send({ fn: 'setBonusRule', args: [household, per, cap] });
        chainCopy.set(k, -1n);
      }
      const { hash, nonce } = await chain.send(call);
      await db
        .update(ledgerTx)
        .set({ status: 'sent', nonce, txHash: hash, attempts: sql`${ledgerTx.attempts} + 1`, error: null, updatedAt: now() })
        .where(eq(ledgerTx.id, t.id));
      result.sent++;
      result.queued--;
    } catch (err) {
      // The node did not take it (down, or refused at once): try again next pass, from here.
      await db
        .update(ledgerTx)
        .set({ attempts: sql`${ledgerTx.attempts} + 1`, error: (err as Error).message.slice(0, 500), updatedAt: now() })
        .where(eq(ledgerTx.id, t.id));
      break;
    }
  }
  return result;
}

/** How the queue stands, for the owner's Ledger screen and readiness. */
export async function signerStatus(db: Db): Promise<Record<'pending' | 'sent' | 'mined' | 'failed', number> | null> {
  const c = await activeContract(db);
  if (!c) return null;
  const rows = await db
    .select({ status: ledgerTx.status, n: count() })
    .from(ledgerTx)
    .where(and(eq(ledgerTx.contractId, c.id), inArray(ledgerTx.status, ['pending', 'sent', 'mined', 'failed'])))
    .groupBy(ledgerTx.status);
  const out = { pending: 0, sent: 0, mined: 0, failed: 0 };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}
