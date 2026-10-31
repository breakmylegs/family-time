// The indexer (brief Part 7, ADR 0014): reads the contract's events from the last block it read,
// and records each entry's confirmation. Idempotent on block number and log index, so reading a
// range twice changes nothing. QBFT blocks are final, so one confirmation is enough.
import { households, ledgerConfirmations, ledgerContracts, ledgerEntries, ledgerTx, people, type Db } from '@family-time/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { Address } from 'viem';
import { TOKEN } from './abi.js';
import { childAddress, effectOf, refHash, type ChainEvent } from './calls.js';
import type { ChainClient } from './client.js';
import { activeContract } from './ledger.js';

export async function indexPass(db: Db, chain: ChainClient): Promise<{ from: number; to: number; confirmed: number }> {
  const c = await activeContract(db);
  if (!c || c.address !== chain.contract.toLowerCase()) return { from: 0, to: 0, confirmed: 0 };
  const from = (c.indexedBlock ?? c.deployedBlock - 1) + 1;
  const to = await chain.blockNumber();
  if (from > to) return { from, to, confirmed: 0 };
  const events = await chain.events(from, to);
  let confirmed = 0;
  await db.transaction(async (tx) => {
    for (const ev of events) {
      const e = effectOf(ev);
      if (!e) continue;
      const rows = await tx
        .insert(ledgerConfirmations)
        .values({ contractId: c.id, refHash: e.ref, event: ev.name, childAddress: e.child, time: e.time, money: e.money, flex: e.flex, blockNumber: ev.blockNumber, logIndex: ev.logIndex, txHash: ev.txHash, at: e.at })
        .onConflictDoNothing()
        .returning({ id: ledgerConfirmations.id });
      confirmed += rows.length;
      // The signer may not have looked at its receipt yet: the event is enough.
      await tx
        .update(ledgerTx)
        .set({ status: 'mined', blockNumber: ev.blockNumber, txHash: ev.txHash, error: null, updatedAt: new Date() })
        .where(and(eq(ledgerTx.contractId, c.id), eq(ledgerTx.refHash, e.ref), inArray(ledgerTx.status, ['pending', 'sent'])));
    }
    await tx.update(ledgerContracts).set({ indexedBlock: to }).where(eq(ledgerContracts.id, c.id));
  });
  return { from, to, confirmed };
}

export interface ChainCheck {
  ok: boolean;
  /** Entries in Postgres, and events on chain. */
  entries: number;
  events: number;
  /** Entries still waiting to be sent or mined: not problems, just not there yet. */
  waiting: number;
  problems: string[];
}

/**
 * The read model rebuilt from the chain alone: every ledger event since the contract was
 * deployed, matched to the Postgres entries by reference, then every child's three balances
 * compared with the contract's own. Reason text stays off chain (it can name a child, and a chain
 * cannot forget), so the match is on reference, kind of change, child, amounts and time.
 */
export async function checkAgainstChain(db: Db, chain: ChainClient): Promise<ChainCheck> {
  const c = await activeContract(db);
  if (!c) return { ok: false, entries: 0, events: 0, waiting: 0, problems: ['No ledger contract is active. Run ./scripts/ft.sh ledger-deploy first.'] };
  const latest = await chain.blockNumber();
  const events = (await chain.events(c.deployedBlock, latest)).map((ev: ChainEvent) => ({ ev, e: effectOf(ev) })).filter((x) => x.e);
  const onChain = new Map(events.map(({ ev, e }) => [e!.ref, { ...e!, name: ev.name }]));
  const entries = await db.select().from(ledgerEntries);
  const waitingRows = await db
    .select({ entryId: ledgerTx.entryId })
    .from(ledgerTx)
    .where(and(eq(ledgerTx.contractId, c.id), inArray(ledgerTx.status, ['pending', 'sent'])));
  const waiting = new Set(waitingRows.map((r) => r.entryId));
  const problems: string[] = [];
  const seen = new Set<string>();
  const totals = new Map<Address, { time: number; money: number; flex: number }>();

  for (const x of entries) {
    const h = refHash(x.householdId, x.ref);
    seen.add(h);
    const ev = onChain.get(h);
    if (!ev) {
      if (!waiting.has(x.id)) problems.push(`Entry ${x.seq} (${x.kind}) is in Postgres but not on the chain.`);
      continue;
    }
    const child = childAddress(x.childId);
    if (ev.child !== child.toLowerCase()) problems.push(`Entry ${x.seq} is for a different child on the chain.`);
    if (ev.time !== x.time || ev.money !== x.money || ev.flex !== x.flex) {
      problems.push(`Entry ${x.seq} (${x.kind}) differs: Postgres ${x.time}/${x.money}/${x.flex}, chain ${ev.time}/${ev.money}/${ev.flex} (minutes/pence/points).`);
    }
    if (ev.at.getTime() !== x.at.getTime()) problems.push(`Entry ${x.seq} has a different time on the chain.`);
  }
  for (const [h, ev] of onChain) {
    if (!seen.has(h)) problems.push(`A ${ev.name} event on the chain (block ${events.find((x) => x.e!.ref === h)?.ev.blockNumber}) has no entry in Postgres.`);
    const t = totals.get(ev.child) ?? { time: 0, money: 0, flex: 0 };
    totals.set(ev.child, { time: t.time + ev.time, money: t.money + ev.money, flex: t.flex + ev.flex });
  }

  // Balances: the events summed must be what the contract holds, for every child.
  const kids = await db.select({ id: people.id }).from(people).innerJoin(households, eq(households.id, people.householdId)).where(eq(people.role, 'child'));
  for (const k of kids) {
    const a = childAddress(k.id).toLowerCase() as Address;
    const t = totals.get(a) ?? { time: 0, money: 0, flex: 0 };
    const [time, money, flex] = await Promise.all([chain.balanceOf(a, TOKEN.TIME), chain.balanceOf(a, TOKEN.MONEY), chain.balanceOf(a, TOKEN.FLEX)]);
    if (Number(time) !== t.time || Number(money) !== t.money || Number(flex) !== t.flex) {
      problems.push(`A child's balances on the contract (${time}/${money}/${flex}) are not what its events add up to (${t.time}/${t.money}/${t.flex}).`);
    }
  }
  return { ok: problems.length === 0, entries: entries.length, events: onChain.size, waiting: waiting.size, problems };
}
