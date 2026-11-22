import { AdGuard, adguardFetch } from '@family-time/adguard-client';
import { connectionConfig, readSecret, schema, type Db } from '@family-time/db';
import { besuLedger, DEFAULT_CHAIN_ID, viemChain } from '@family-time/ledger';
import { CHANGE_CHANNEL, vapidFromFile } from '@family-time/notify';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { jsonLog, startWorker } from './worker.js';

const log = jsonLog('worker', process.env.LOG_LEVEL ?? 'info');
const config = connectionConfig();
const pool = new pg.Pool({ ...config, max: 5 });
const db = drizzle(pool, { schema }) as unknown as Db;
const boss = new PgBoss({ ...config, max: 5 } as ConstructorParameters<typeof PgBoss>[0]);

// AdGuard's admin API: the household's own AdGuard on the home network (the default), or the
// bundled one on the internal network (ADR 0022). ADGUARD_URL and ADGUARD_USER come from
// deploy/.state/adguard.env, written by init.sh, with the password in secrets/adguard_password.
const adguardPassword = readSecret('ADGUARD_PASSWORD');
// The owner's self-signed certificate, when they opted in, trusted by the AdGuard client only.
const adguardFetchImpl = adguardFetch(process.env.ADGUARD_CA_FILE);
const adguard = adguardPassword
  ? new AdGuard({
      baseUrl: process.env.ADGUARD_URL ?? 'http://adguard:3000',
      username: process.env.ADGUARD_USER ?? 'familytime',
      password: adguardPassword,
      ...(adguardFetchImpl ? { fetchImpl: adguardFetchImpl } : {}),
    })
  : undefined;

// After each run, the api's open Control screens hear about it (the api LISTENs on this channel).
const notifyChange = async () => {
  await pool.query('select pg_notify($1, id::text) from households', [CHANGE_CHANNEL]);
};
const vapid = vapidFromFile(process.env.VAPID_PRIVATE_KEY_FILE);

// The Besu ledger (ADR 0014), when the owner has switched it on: LEDGER_ADAPTER=besu, the
// ledger-besu Compose profile, and the signer key init.sh made.
const signerKey = process.env.LEDGER_ADAPTER === 'besu' ? readSecret('LEDGER_SIGNER_KEY') : undefined;
if (process.env.LEDGER_ADAPTER === 'besu' && !signerKey) log('error', 'ledger_no_signer_key', { reason: 'Run ./scripts/init.sh again' });
const chainOptions = signerKey
  ? { rpcUrl: process.env.BESU_RPC_URL ?? 'http://besu:8545', chainId: Number(process.env.BESU_CHAIN_ID ?? DEFAULT_CHAIN_ID), privateKey: (signerKey.startsWith('0x') ? signerKey : `0x${signerKey}`) as `0x${string}` }
  : undefined;
const chains = new Map<string, ReturnType<typeof viemChain>>();
const chain = chainOptions
  ? (contract: `0x${string}`) => chains.get(contract) ?? chains.set(contract, viemChain({ ...chainOptions, contract })).get(contract)!
  : undefined;

const worker = await startWorker({
  boss,
  db,
  commit: process.env.GIT_COMMIT || 'dev',
  now: () => new Date(),
  log,
  notifyChange,
  ...(adguard ? { adguard } : {}),
  ...(vapid ? { push: { vapid } } : {}),
  ...(chain ? { chain, ledger: besuLedger(db) } : {}),
});

const shutdown = async (signal: string) => {
  log('info', 'shutdown', { signal });
  await worker.stop();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
