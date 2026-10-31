// What the signer and the indexer need from a chain. The real one is viem on Besu (viem.ts); the
// fake (fake.ts) keeps the contract's rules in memory, so both run in the laptop's tests.
import type { Address, Hex } from 'viem';
import type { ChainCall, ChainEvent } from './calls.js';

export interface Receipt {
  status: 'success' | 'reverted';
  blockNumber: number;
  /** Why it reverted, when the chain can say. */
  reason?: string;
}

export interface ChainClient {
  /** The signer's address. */
  readonly signer: Address;
  readonly contract: Address;
  /**
   * Sends the call with the next nonce and a fixed gas limit, without estimating: estimates run
   * against the last block, so a call that depends on one still waiting would be refused wrongly.
   * Postgres has checked the entry already. Returns the hash at once; it is mined later.
   */
  send(call: ChainCall): Promise<{ hash: Hex; nonce: number }>;
  /** Null until mined. */
  receipt(hash: Hex): Promise<Receipt | null>;
  /** The signer's next nonce, counting transactions still waiting to be mined. */
  pendingNonce(): Promise<number>;
  blockNumber(): Promise<number>;
  /** The contract's events in a block range, inclusive, in chain order. */
  events(fromBlock: number, toBlock: number): Promise<ChainEvent[]>;
  balanceOf(child: Address, id: bigint): Promise<bigint>;
  rate(household: Hex, id: bigint): Promise<bigint>;
}

/** A refusal from the contract, with its error name ("RefUsed", "ERC1155InsufficientBalance"). */
export class ChainRefusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}
