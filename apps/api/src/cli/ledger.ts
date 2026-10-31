// The Besu ledger's server commands (ADR 0014): deploy a contract and replay the history onto it,
// check the chain against Postgres, and show how the signer's queue stands.
import { readSecret, type Db } from '@family-time/db';
import { activateContract, activeContract, checkAgainstChain, CONTRACT_VERSION, DEFAULT_CHAIN_ID, deployFamilyLedger, readArtifact, signerAddress, signerStatus, viemChain, type ViemOptions } from '@family-time/ledger';
import { CliError } from './commands.js';

type Hex = `0x${string}`;
const hex = (s: string): Hex => (s.startsWith('0x') ? s : `0x${s}`) as Hex;

/** The node and the signer key, from the environment Compose gives the api and the worker. */
export function chainOptions(): ViemOptions {
  if (process.env.LEDGER_ADAPTER !== 'besu') throw new CliError('The Besu ledger is not switched on. See docs/setup/besu.md: set LEDGER_ADAPTER=besu and start the ledger-besu profile.');
  const key = readSecret('LEDGER_SIGNER_KEY');
  if (!key) throw new CliError('There is no ledger signer key. Run ./scripts/init.sh again.');
  return { rpcUrl: process.env.BESU_RPC_URL ?? 'http://besu:8545', chainId: Number(process.env.BESU_CHAIN_ID ?? DEFAULT_CHAIN_ID), privateKey: hex(key.trim()) };
}

/**
 * Deploys a new contract and replays every entry onto it. The admin role goes to the cold key's
 * address: given with --admin, or worked out from the key piped in on standard input, which is
 * read once and never kept.
 */
export async function ledgerDeploy(db: Db, args: { admin?: string; adminKey?: string }): Promise<{ address: string; block: number; queued: number; admin: string }> {
  const o = chainOptions();
  let admin = args.admin;
  if (!admin && args.adminKey) admin = signerAddress(hex(args.adminKey.trim()));
  if (!admin || !/^0x[0-9a-fA-F]{40}$/.test(admin)) {
    throw new CliError('Give the admin key, or its address: ./scripts/ft.sh ledger-deploy < secrets/ledger_admin_key (or --admin 0x...).');
  }
  if (admin.toLowerCase() === signerAddress(o.privateKey).toLowerCase()) throw new CliError('The admin key must not be the signer key.');
  const { bytecode } = readArtifact();
  const deployed = await deployFamilyLedger({ ...o, admin: admin as Hex, bytecode });
  const { queued } = await activateContract(db, { address: deployed.address, chainId: deployed.chainId, version: CONTRACT_VERSION, deployedBlock: deployed.blockNumber });
  return { address: deployed.address, block: deployed.blockNumber, queued, admin };
}

export async function ledgerCheck(db: Db) {
  const c = await activeContract(db);
  if (!c) throw new CliError('No ledger contract is deployed yet. Run ./scripts/ft.sh ledger-deploy first.');
  return checkAgainstChain(db, viemChain({ ...chainOptions(), contract: c.address as Hex }));
}

export async function ledgerStatus(db: Db) {
  const c = await activeContract(db);
  return { contract: c, queue: await signerStatus(db) };
}
