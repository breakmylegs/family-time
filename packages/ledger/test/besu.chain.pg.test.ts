// The Besu adapter on a real Besu node and real Postgres, in the deploy's test project, where
// BESU_RPC_URL and DATABASE_URL are set (deploy/compose.test.yml). It deploys the contract forge
// compiled, checks the hand-written ABI against it, then runs the whole ledger contract with
// every test drained to the chain and every balance rebuilt from its events.
import { households, migrationsFolder, people, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activateContract, besuLedger, checkAgainstChain, DEFAULT_CHAIN_ID, deployFamilyLedger, familyLedgerAbi, indexPass, readArtifact, signerPass, viemChain, type ChainClient } from '../src/index.js';
import { ledgerSuite } from './suite.js';

const url = process.env.DATABASE_URL;
const rpcUrl = process.env.BESU_RPC_URL;
const artifactPath = fileURLToPath(new URL('../../../contracts/out/FamilyLedger.sol/FamilyLedger.json', import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!url || !rpcUrl)('the Besu adapter on a real chain', () => {
  // Its own database, so the other suites' entries are not replayed onto this contract.
  const name = `ledger_besu_${process.pid}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: Db;
  let chain: ChainClient;
  const privateKey = generatePrivateKey();
  const options = { rpcUrl: rpcUrl!, chainId: Number(process.env.BESU_CHAIN_ID ?? DEFAULT_CHAIN_ID), privateKey };

  /** Sends and confirms until nothing is left, waiting for blocks as it goes. */
  async function drain() {
    for (let i = 0; i < 240; i++) {
      const s = await signerPass(db, chain);
      await indexPass(db, chain);
      if (s.stopped) throw new Error(`The signer stopped at ${s.stopped.entryRef}: ${s.stopped.reason}`);
      if (!s.sent && !s.waiting && !s.queued && !s.mined) return;
      await sleep(500);
    }
    throw new Error('The queue did not drain in two minutes');
  }

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create database ${name}`);
    const u = new URL(url!);
    u.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: u.toString(), max: 6 });
    db = drizzle(pool, { schema }) as unknown as Db;
    await migrate(drizzle(pool), { migrationsFolder });

    // The node takes a little while to make its first block.
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      try {
        ready = (await fetch(rpcUrl!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) })).ok;
      } catch {
        await sleep(1000);
      }
    }
    expect(ready).toBe(true);
    const { bytecode } = readArtifact(artifactPath);
    const deployed = await deployFamilyLedger({ ...options, admin: privateKeyToAccount(generatePrivateKey()).address, bytecode });
    await activateContract(db, { address: deployed.address, chainId: deployed.chainId, version: '1', deployedBlock: deployed.blockNumber });
    chain = viemChain({ ...options, contract: deployed.address });
  }, 300_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists ${name} with (force)`);
    await admin?.end();
  });

  it('has the interface forge compiled, exactly', () => {
    // By kind, name, input types and which are indexed: the compiler leaves getter inputs unnamed.
    type Item = { type: string; name?: string; inputs?: { type: string; indexed?: boolean }[] };
    const signatures = (abi: readonly unknown[]) =>
      (abi as Item[])
        .filter((x) => ['function', 'event', 'error'].includes(x.type))
        .map((x) => `${x.type} ${x.name}(${(x.inputs ?? []).map((i) => `${i.type}${i.indexed ? ' indexed' : ''}`).join(',')})`)
        .sort();
    const compiled = signatures(readArtifact(artifactPath).abi);
    // Every call and event the app uses is in the contract as written.
    for (const s of signatures(familyLedgerAbi)) expect(compiled).toContain(s);
  });

  ledgerSuite('Besu (real chain)', async () => {
    const [hh] = await db.insert(households).values({ name: 'Ledger test' }).returning();
    const [a] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Ollie', role: 'child' }).returning();
    const [b] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Jamie', role: 'child' }).returning();
    return {
      ledger: besuLedger(db),
      householdId: hh!.id,
      childId: a!.id,
      otherChildId: b!.id,
      close: async () => {
        await drain();
        const check = await checkAgainstChain(db, chain);
        expect(check.problems).toEqual([]);
        expect(check.waiting).toBe(0);
      },
    };
  });
});
