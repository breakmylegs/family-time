// The chain client on viem, for the family's Besu node (ADR 0014). Gas is free on this chain
// (min-gas-price 0, zero base fee), so transactions are legacy ones at a gas price of zero with a
// fixed gas limit, and the signer's account needs no balance.
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, http, TransactionReceiptNotFoundError, type Address, type Hex } from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';
import { familyLedgerAbi } from './abi.js';
import type { ChainEvent } from './calls.js';
import type { ChainClient } from './client.js';

/** The chain id in the genesis that init.sh writes. */
export const DEFAULT_CHAIN_ID = 4242;
/** Far above any entry's need (a conversion is about 120 000); gas costs nothing here. */
const GAS = 1_000_000n;
/** Besu answers eth_getLogs for ranges this size quickly. */
const LOG_RANGE = 5_000;

export interface ViemOptions {
  rpcUrl: string;
  chainId?: number;
  privateKey: Hex;
}

function clients(o: ViemOptions) {
  const chain = defineChain({
    id: o.chainId ?? DEFAULT_CHAIN_ID,
    name: 'Family time',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [o.rpcUrl] } },
  });
  const account = privateKeyToAccount(o.privateKey, { nonceManager });
  const publicClient = createPublicClient({ chain, transport: http(o.rpcUrl, { retryCount: 2 }) });
  const walletClient = createWalletClient({ chain, account, transport: http(o.rpcUrl, { retryCount: 0 }) });
  return { chain, account, publicClient, walletClient };
}

export function viemChain(o: ViemOptions & { contract: Address }): ChainClient {
  const { chain, account, publicClient, walletClient } = clients(o);
  const manager = account.nonceManager!;
  return {
    signer: account.address,
    contract: o.contract,
    async send(call) {
      const nonce = await manager.consume({ address: account.address, chainId: chain.id, client: publicClient });
      try {
        const hash = await walletClient.writeContract({
          address: o.contract,
          abi: familyLedgerAbi,
          functionName: call.fn,
          args: call.args as never,
          gas: GAS,
          gasPrice: 0n,
          nonce,
        });
        return { hash, nonce };
      } catch (err) {
        // The nonce was not used: start again from the node's count, so the next send has no gap.
        manager.reset({ address: account.address, chainId: chain.id });
        throw err;
      }
    },
    async receipt(hash) {
      try {
        const r = await publicClient.getTransactionReceipt({ hash });
        return { status: r.status, blockNumber: Number(r.blockNumber) };
      } catch (err) {
        if (err instanceof TransactionReceiptNotFoundError) return null;
        throw err;
      }
    },
    pendingNonce: () => publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }),
    blockNumber: async () => Number(await publicClient.getBlockNumber()),
    async events(fromBlock, toBlock) {
      const out: ChainEvent[] = [];
      for (let from = fromBlock; from <= toBlock; from += LOG_RANGE) {
        const logs = await publicClient.getContractEvents({ address: o.contract, abi: familyLedgerAbi, fromBlock: BigInt(from), toBlock: BigInt(Math.min(toBlock, from + LOG_RANGE - 1)) });
        for (const l of logs) out.push({ name: l.eventName, args: l.args as Record<string, unknown>, blockNumber: Number(l.blockNumber), logIndex: l.logIndex, txHash: l.transactionHash });
      }
      return out;
    },
    balanceOf: (child, id) => publicClient.readContract({ address: o.contract, abi: familyLedgerAbi, functionName: 'balanceOf', args: [child, id] }),
    rate: (household, id) => publicClient.readContract({ address: o.contract, abi: familyLedgerAbi, functionName: 'rate', args: [household, id] }),
    async bonusRule(household) {
      const [pencePerBlock, weeklyCapPence] = await publicClient.readContract({ address: o.contract, abi: familyLedgerAbi, functionName: 'bonusRule', args: [household] });
      return { pencePerBlock, weeklyCapPence };
    },
  };
}

/** The compiled contract from the image's contracts stage. */
export function readArtifact(path = process.env.LEDGER_ARTIFACT ?? 'contracts/out/FamilyLedger.sol/FamilyLedger.json'): { abi: unknown[]; bytecode: Hex } {
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: unknown[]; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

/**
 * Deploys a new FamilyLedger. The admin is only an address: the cold key never signs. The signer
 * deploying it gets the writing roles from the constructor.
 */
export async function deployFamilyLedger(o: ViemOptions & { admin: Address; bytecode: Hex }): Promise<{ address: Address; blockNumber: number; chainId: number; signer: Address }> {
  const { chain, account, publicClient, walletClient } = clients(o);
  const hash = await walletClient.deployContract({ abi: familyLedgerAbi, bytecode: o.bytecode, args: [o.admin, account.address], gas: 6_000_000n, gasPrice: 0n });
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`The deploy transaction ${hash} failed.`);
  return { address: r.contractAddress, blockNumber: Number(r.blockNumber), chainId: chain.id, signer: account.address };
}

/** The signer's address for a key, without touching the chain. */
export const signerAddress = (privateKey: Hex): Address => privateKeyToAccount(privateKey).address;
