// The Besu adapter (ADR 0014). It validates and writes exactly as the Postgres ledger does, under
// the same lock, and in the same transaction queues the entry's chain transaction for the active
// contract. The api answers at once; the signer sends, the indexer confirms. History carries the
// block and transaction of each confirmed entry.
import { ledgerConfirmations, ledgerContracts, ledgerEntries, ledgerTx, type Db } from '@family-time/db';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { LedgerEntry, LedgerPort } from '../port.js';
import { postgresLedger, type Tx } from '../postgres.js';
import { refHash } from './calls.js';

type Q = Db | Tx;

export async function activeContract(q: Q) {
  return (await q.select().from(ledgerContracts).where(eq(ledgerContracts.active, true)))[0] ?? null;
}

export function besuLedger(db: Db): LedgerPort {
  const pg = postgresLedger(db, {
    onAppend: async (tx, entry) => {
      const c = await activeContract(tx);
      // With no contract yet, entries wait for the deploy, which replays the whole history.
      if (!c) return;
      await tx.insert(ledgerTx).values({ contractId: c.id, entryId: entry.id, refHash: refHash(entry.householdId, entry.ref) }).onConflictDoNothing();
    },
  });

  /** Fills in the block and transaction of each entry the chain has confirmed. */
  const confirmed = async (entries: LedgerEntry[]): Promise<LedgerEntry[]> => {
    const c = await activeContract(db);
    if (!c || !entries.length) return entries;
    const hashes = entries.map((e) => refHash(e.householdId, e.ref));
    const rows = await db
      .select({ refHash: ledgerConfirmations.refHash, blockNumber: ledgerConfirmations.blockNumber, txHash: ledgerConfirmations.txHash })
      .from(ledgerConfirmations)
      .where(and(eq(ledgerConfirmations.contractId, c.id), inArray(ledgerConfirmations.refHash, hashes)));
    const by = new Map(rows.map((r) => [r.refHash, r]));
    return entries.map((e, i) => {
      const r = by.get(hashes[i]!);
      return r ? { ...e, blockNumber: r.blockNumber, txHash: r.txHash } : e;
    });
  };

  return { ...pg, history: async (householdId, childId, options) => confirmed(await pg.history(householdId, childId, options)) };
}

/**
 * Queues every entry not yet on `contractId`, each household in its own order. Used when a contract
 * is deployed, so the whole history from Postgres is replayed onto it (brief Part 7: migrate by
 * redeploy and replay), and by the signer as a catch-up, which finds nothing to do almost always.
 */
export async function queueReplay(q: Q, contractId: string): Promise<number> {
  const done = new Set((await q.select({ entryId: ledgerTx.entryId }).from(ledgerTx).where(eq(ledgerTx.contractId, contractId))).map((r) => r.entryId));
  const households = await q.selectDistinct({ id: ledgerEntries.householdId }).from(ledgerEntries);
  let queued = 0;
  for (const h of households) {
    let after = 0;
    for (;;) {
      // A page at a time, in sequence, to keep memory flat on a long history.
      const page = await q
        .select({ id: ledgerEntries.id, householdId: ledgerEntries.householdId, ref: ledgerEntries.ref, seq: ledgerEntries.seq })
        .from(ledgerEntries)
        .where(and(eq(ledgerEntries.householdId, h.id), gt(ledgerEntries.seq, after)))
        .orderBy(asc(ledgerEntries.seq))
        .limit(500);
      const rows = page.filter((e) => !done.has(e.id)).map((e) => ({ contractId, entryId: e.id, refHash: refHash(e.householdId, e.ref) }));
      if (rows.length) {
        await q.insert(ledgerTx).values(rows).onConflictDoNothing();
        queued += rows.length;
      }
      if (page.length < 500) break;
      after = page[page.length - 1]!.seq;
    }
  }
  return queued;
}

/**
 * Makes a newly deployed contract the active one and queues the whole history onto it, in one
 * transaction, so an entry written meanwhile queues itself after the history, never before it.
 */
export async function activateContract(db: Db, c: { address: string; chainId: number; version: string; deployedBlock: number }): Promise<{ id: string; queued: number }> {
  return db.transaction(async (tx) => {
    await tx.update(ledgerContracts).set({ active: false }).where(eq(ledgerContracts.active, true));
    const [row] = await tx
      .insert(ledgerContracts)
      .values({ address: c.address.toLowerCase(), chainId: c.chainId, version: c.version, deployedBlock: c.deployedBlock, indexedBlock: c.deployedBlock - 1, active: true })
      .returning({ id: ledgerContracts.id });
    return { id: row!.id, queued: await queueReplay(tx, row!.id) };
  });
}
