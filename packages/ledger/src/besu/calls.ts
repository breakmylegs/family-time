// From a ledger entry to the contract call that records it on chain, and from a chain event back
// to the changes it made. One table each way, so the signer, the fake chain and the rebuild check
// cannot disagree.
import { keccak256, toBytes, type Address, type Hex } from 'viem';
import type { LedgerEntry } from '../port.js';
import { TOKEN } from './abi.js';

/** A child's account on chain: an address made from the child's id. No key exists for it. */
export function childAddress(childId: string): Address {
  return `0x${keccak256(toBytes(`family-time:child:${childId.toLowerCase()}`)).slice(-40)}` as Address;
}

/** The household's key for its conversion rates. */
export function householdKey(householdId: string): Hex {
  return keccak256(toBytes(`family-time:household:${householdId.toLowerCase()}`));
}

/** What the contract sees of an entry's ref. Unique per household in Postgres, so the household is in it. */
export function refHash(householdId: string, ref: string): Hex {
  return keccak256(toBytes(`family-time:ref:${householdId.toLowerCase()}:${ref}`));
}

const token = (currency: unknown): bigint => {
  if (currency === 'TIME') return TOKEN.TIME;
  if (currency === 'MONEY') return TOKEN.MONEY;
  if (currency === 'FLEX') return TOKEN.FLEX;
  throw new Error(`Unknown currency ${String(currency)}`);
};

export type ChainCall =
  | { fn: 'allocateAllowance'; args: [Hex, Address, bigint, bigint] }
  | { fn: 'award'; args: [Hex, Address, bigint, bigint, bigint] }
  | { fn: 'spendTime'; args: [Hex, Address, bigint, bigint] }
  | { fn: 'refund'; args: [Hex, Address, bigint, bigint, boolean, bigint] }
  | { fn: 'convert'; args: [Hex, Hex, Address, bigint, bigint, bigint, bigint] }
  | { fn: 'closeWeek'; args: [Hex, Hex, Address, bigint, bigint, bigint] }
  | { fn: 'recordPayout'; args: [Hex, Address, bigint, bigint] }
  | { fn: 'reverse'; args: [Hex, Hex, bigint] }
  | { fn: 'setRate'; args: [Hex, bigint, bigint] }
  | { fn: 'setBonusRule'; args: [Hex, bigint, bigint] };

const big = (n: number) => BigInt(n);

/** The call that records `e`. Amounts come from the entry as written, so the chain holds exactly what Postgres does. */
export function callFor(e: Pick<LedgerEntry, 'householdId' | 'childId' | 'kind' | 'time' | 'money' | 'flex' | 'ref' | 'data' | 'at'>): ChainCall {
  const ref = refHash(e.householdId, e.ref);
  const child = childAddress(e.childId);
  const at = big(e.at.getTime());
  switch (e.kind) {
    case 'allowance':
      return { fn: 'allocateAllowance', args: [ref, child, big(e.time), at] };
    case 'award': {
      const id = token(e.data.currency);
      return { fn: 'award', args: [ref, child, id, big(id === TOKEN.TIME ? e.time : id === TOKEN.MONEY ? e.money : e.flex), at] };
    }
    case 'spend':
      return { fn: 'spendTime', args: [ref, child, big(-e.time), at] };
    case 'refund': {
      const id = token(e.data.currency);
      return { fn: 'refund', args: [ref, child, id, big(id === TOKEN.TIME ? e.time : id === TOKEN.MONEY ? e.money : e.flex), e.data.source === 'chosen', at] };
    }
    case 'convert': {
      const toId = e.data.to === 'TIME' ? TOKEN.TIME : TOKEN.MONEY;
      return { fn: 'convert', args: [ref, householdKey(e.householdId), child, big(-e.flex), toId, big(toId === TOKEN.TIME ? e.time : e.money), at] };
    }
    case 'close':
      return { fn: 'closeWeek', args: [ref, householdKey(e.householdId), child, big(-e.time), big(e.money), at] };
    case 'payout':
      return { fn: 'recordPayout', args: [ref, child, big(-e.money), at] };
    case 'reversal':
      return { fn: 'reverse', args: [ref, refHash(e.householdId, String(e.data.reverses)), at] };
  }
}

/** A ledger event as the indexer reads it. */
export interface ChainEvent {
  name: string;
  args: Record<string, unknown>;
  blockNumber: number;
  logIndex: number;
  txHash: Hex;
}

/** The changes a ledger event made, or null for events that are not entries (RateSet). */
export function effectOf(ev: Pick<ChainEvent, 'name' | 'args'>): { ref: Hex; child: Address; time: number; money: number; flex: number; at: Date } | null {
  const a = ev.args;
  // RateSet and anything else that is not an entry has no child and no reference.
  if (typeof a.child !== 'string' || typeof a.ref !== 'string') return null;
  const n = (k: string) => Number(a[k] as bigint);
  const base = { ref: a.ref as Hex, child: (a.child as string).toLowerCase() as Address, at: new Date(n('at')), time: 0, money: 0, flex: 0 };
  const into = (id: bigint, amount: number) => (id === TOKEN.TIME ? { time: amount } : id === TOKEN.MONEY ? { money: amount } : { flex: amount });
  switch (ev.name) {
    case 'AllowanceAllocated':
      return { ...base, time: n('mins') };
    case 'TaskRewarded':
    case 'Refunded':
      return { ...base, ...into(a.id as bigint, n('amount')) };
    case 'TimeSpent':
      return { ...base, time: -n('mins') };
    case 'Converted':
      return { ...base, flex: -n('points'), ...into(a.toId as bigint, n('amount')) };
    case 'WeekClosed':
      return { ...base, time: -n('expiredMinutes'), money: n('bonusPence') };
    case 'PayoutRecorded':
      return { ...base, money: -n('pence') };
    case 'Reversed':
      return { ...base, time: n('time'), money: n('money'), flex: n('flex') };
    default:
      return null;
  }
}
