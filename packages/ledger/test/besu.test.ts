// The Besu adapter on PGlite and the fake chain: the whole ledger contract, with every test ending
// by draining the queue to the chain and rebuilding the balances from its events; then the
// signer's and the indexer's own behaviour. test/besu.chain.test.ts runs the same on a real Besu.
import { households, ledgerConfirmations, ledgerContracts, ledgerTx, people, type Db } from '@family-time/db';
import { testDb } from '@family-time/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { activateContract, besuLedger, checkAgainstChain, fakeChain, indexPass, postgresLedger, signerPass, TOKEN, childAddress, type ChainClient, type FakeChain } from '../src/index.js';
import { ledgerSuite } from './suite.js';

/** Runs the signer and the indexer until nothing is left to send or confirm. */
export async function drain(db: Db, chain: ChainClient, mine?: () => void) {
  for (let i = 0; i < 50; i++) {
    const s = await signerPass(db, chain);
    mine?.();
    await indexPass(db, chain);
    if (s.stopped) throw new Error(`The signer stopped at ${s.stopped.entryRef}: ${s.stopped.reason}`);
    if (!s.sent && !s.waiting && !s.queued && !s.mined) return;
  }
  throw new Error('The queue did not drain');
}

async function setup(chain: FakeChain = fakeChain()) {
  const handle = await testDb();
  const [hh] = await handle.db.insert(households).values({ name: 'Test' }).returning();
  const [a] = await handle.db.insert(people).values({ householdId: hh!.id, displayName: 'Ollie', role: 'child' }).returning();
  const [b] = await handle.db.insert(people).values({ householdId: hh!.id, displayName: 'Jamie', role: 'child' }).returning();
  return { handle, db: handle.db, chain, householdId: hh!.id, childId: a!.id, otherChildId: b!.id };
}

ledgerSuite('Besu (fake chain)', async () => {
  const s = await setup();
  await activateContract(s.db, { address: s.chain.contract, chainId: 1, version: '1', deployedBlock: 1 });
  return {
    ledger: besuLedger(s.db),
    householdId: s.householdId,
    childId: s.childId,
    otherChildId: s.otherChildId,
    // Every test ends with the chain holding exactly what Postgres does.
    close: async () => {
      try {
        await drain(s.db, s.chain);
        const check = await checkAgainstChain(s.db, s.chain);
        expect(check.problems).toEqual([]);
        expect(check.waiting).toBe(0);
      } finally {
        await s.handle.close();
      }
    },
  };
});

describe('the Besu adapter', () => {
  const at = new Date('2026-10-26T17:05:00Z');

  it('replays a Postgres history onto a new contract, and the chain matches it', async () => {
    const s = await setup();
    try {
      const pg = postgresLedger(s.db);
      const base = { householdId: s.householdId, childId: s.childId, at };
      await pg.allocateAllowance({ ...base, ref: 'week:1', reason: 'Weekly time', minutes: 420 });
      await pg.award({ ...base, ref: 'job:1', reason: 'Dishes', currency: 'FLEX', amount: 20 });
      await pg.convert({ ...base, ref: 'convert:1', reason: 'Points into money', points: 10, to: 'MONEY', amount: 10 });
      await pg.spendTime({ ...base, ref: 'grant:1', reason: 'Roblox', minutes: 30 });
      await pg.recordPayout({ ...base, ref: 'payout:1', reason: 'Pocket money paid', pence: 10 });
      await pg.reverse({ ...base, ref: 'fix:payout:1', reason: 'Put right', entryRef: 'payout:1' });
      const { queued } = await activateContract(s.db, { address: s.chain.contract, chainId: 1, version: '1', deployedBlock: 1 });
      expect(queued).toBe(6);
      await drain(s.db, s.chain);
      expect(await checkAgainstChain(s.db, s.chain)).toMatchObject({ ok: true, entries: 6, events: 6, waiting: 0 });
      const kid = childAddress(s.childId);
      expect(await s.chain.balanceOf(kid, TOKEN.TIME)).toBe(390n);
      expect(await s.chain.balanceOf(kid, TOKEN.MONEY)).toBe(10n);
      expect(await s.chain.balanceOf(kid, TOKEN.FLEX)).toBe(10n);
      // The conversion set the household's rate on chain once, before converting.
      expect(s.chain.sent.filter((c) => c.fn === 'setRate')).toHaveLength(1);
      // History carries each entry's block and transaction.
      const lines = await besuLedger(s.db).history(s.householdId, s.childId);
      expect(lines.every((l) => l.blockNumber && l.txHash)).toBe(true);
    } finally {
      await s.handle.close();
    }
  });

  it('answers at once, and the chain catches up', async () => {
    const chain = fakeChain({ manual: true });
    const s = await setup(chain);
    try {
      await activateContract(s.db, { address: chain.contract, chainId: 1, version: '1', deployedBlock: 1 });
      const ledger = besuLedger(s.db);
      const entry = await ledger.award({ householdId: s.householdId, childId: s.childId, at, ref: 'job:1', reason: 'Dishes', currency: 'MONEY', amount: 50 });
      expect(entry.blockNumber).toBeNull();
      expect(await ledger.balances(s.householdId, s.childId)).toMatchObject({ money: 50 });
      expect((await signerPass(s.db, chain)).sent).toBe(1);
      // Sent, not mined: nothing more goes until it is, so order holds.
      await ledger.award({ householdId: s.householdId, childId: s.childId, at, ref: 'job:2', reason: 'Dishes', currency: 'MONEY', amount: 50 });
      expect(await signerPass(s.db, chain)).toMatchObject({ sent: 0, waiting: 1, queued: 1 });
      chain.mine();
      await drain(s.db, chain, () => chain.mine());
      const [line] = await ledger.history(s.householdId, s.childId, { limit: 1 });
      expect(line!.blockNumber).toBeGreaterThan(0);
    } finally {
      await s.handle.close();
    }
  });

  it('sends again what the node dropped, as it would after a restart', async () => {
    const chain = fakeChain({ manual: true });
    const s = await setup(chain);
    try {
      await activateContract(s.db, { address: chain.contract, chainId: 1, version: '1', deployedBlock: 1 });
      const ledger = besuLedger(s.db);
      await ledger.allocateAllowance({ householdId: s.householdId, childId: s.childId, at, ref: 'week:1', reason: 'Weekly time', minutes: 420 });
      await signerPass(s.db, chain);
      chain.dropPending();
      // The next pass sees the nonce is no longer counted, and queues it again.
      expect(await signerPass(s.db, chain)).toMatchObject({ waiting: 0 });
      await drain(s.db, chain, () => chain.mine());
      expect((await checkAgainstChain(s.db, chain)).ok).toBe(true);
      expect(chain.sent.filter((c) => c.fn === 'allocateAllowance')).toHaveLength(2);
    } finally {
      await s.handle.close();
    }
  });

  it('stops, and says so, when the chain refuses an entry Postgres took', async () => {
    const s = await setup();
    try {
      await activateContract(s.db, { address: s.chain.contract, chainId: 1, version: '1', deployedBlock: 1 });
      const ledger = besuLedger(s.db);
      const base = { householdId: s.householdId, childId: s.childId, at };
      await ledger.allocateAllowance({ ...base, ref: 'week:1', reason: 'Weekly time', minutes: 30 });
      await drain(s.db, s.chain);
      // Something spends on the chain behind Postgres's back, so the next spend cannot fit there.
      await s.chain.send({ fn: 'spendTime', args: ['0x'.padEnd(66, '1') as `0x${string}`, childAddress(s.childId), 30n, 0n] });
      await ledger.spendTime({ ...base, ref: 'grant:1', reason: 'Roblox', minutes: 30 });
      await ledger.award({ ...base, ref: 'job:1', reason: 'Dishes', currency: 'MONEY', amount: 50 });
      const told: string[] = [];
      const onFailed = async (f: { entryRef: string; reason: string }) => void told.push(`${f.entryRef}: ${f.reason}`);
      await signerPass(s.db, s.chain, { onFailed });
      const after = await signerPass(s.db, s.chain, { onFailed });
      expect(after.stopped).toMatchObject({ entryRef: 'grant:1', reason: 'ERC1155InsufficientBalance' });
      expect(told).toEqual(['grant:1: ERC1155InsufficientBalance']);
      // Nothing new is sent until the owner has looked.
      await ledger.award({ ...base, ref: 'job:2', reason: 'Dishes', currency: 'MONEY', amount: 50 });
      expect(await signerPass(s.db, s.chain, { onFailed })).toMatchObject({ sent: 0, queued: 1, stopped: { entryRef: 'grant:1' } });
      expect(told).toHaveLength(1);
      expect((await s.db.select().from(ledgerTx).where(eq(ledgerTx.status, 'pending'))).length).toBe(1);
      const check = await checkAgainstChain(s.db, s.chain);
      expect(check.ok).toBe(false);
      expect(check.problems.join(' ')).toMatch(/no entry in Postgres/);
    } finally {
      await s.handle.close();
    }
  });

  it('reads each event once, however often the indexer runs over it', async () => {
    const s = await setup();
    try {
      const { id } = await activateContract(s.db, { address: s.chain.contract, chainId: 1, version: '1', deployedBlock: 1 });
      const ledger = besuLedger(s.db);
      await ledger.award({ householdId: s.householdId, childId: s.childId, at, ref: 'job:1', reason: 'Dishes', currency: 'MONEY', amount: 50 });
      await drain(s.db, s.chain);
      await s.db.update(ledgerContracts).set({ indexedBlock: 0 }).where(eq(ledgerContracts.id, id));
      expect((await indexPass(s.db, s.chain)).confirmed).toBe(0);
      expect(await s.db.select().from(ledgerConfirmations)).toHaveLength(1);
    } finally {
      await s.handle.close();
    }
  });

  it('waits, and loses nothing, when no contract is deployed yet', async () => {
    const s = await setup();
    try {
      const ledger = besuLedger(s.db);
      await ledger.award({ householdId: s.householdId, childId: s.childId, at, ref: 'job:1', reason: 'Dishes', currency: 'MONEY', amount: 50 });
      expect(await signerPass(s.db, s.chain)).toMatchObject({ sent: 0 });
      expect(await s.db.select().from(ledgerTx)).toHaveLength(0);
      await activateContract(s.db, { address: s.chain.contract, chainId: 1, version: '1', deployedBlock: 1 });
      await drain(s.db, s.chain);
      expect((await checkAgainstChain(s.db, s.chain)).ok).toBe(true);
    } finally {
      await s.handle.close();
    }
  });
});
