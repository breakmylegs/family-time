// A chain in memory that keeps the contract's rules: references once, soulbound balances that
// never go below zero, fixed burn paths, conversions at the rate on chain, and corrections that
// undo one entry exactly, once. Each send is mined into its own block when `mine()` runs, so tests
// can hold transactions "in the mempool" and see what a restart does with them.
import { keccak256, toBytes, type Address, type Hex } from 'viem';
import { TOKEN } from './abi.js';
import type { ChainCall, ChainEvent } from './calls.js';
import { ChainRefusal, type ChainClient, type Receipt } from './client.js';

interface Effect {
  child: Address;
  time: bigint;
  money: bigint;
  flex: bigint;
  week: number;
  reversible: boolean;
  reversed: boolean;
}

interface Pending {
  hash: Hex;
  nonce: number;
  call: ChainCall;
}

export interface FakeChain extends ChainClient {
  /** Mines everything waiting, one block per transaction. Called by `send` unless `manual`. */
  mine(): void;
  /** Forgets everything waiting, as if the node restarted and dropped its mempool. */
  dropPending(): void;
  /** Every transaction sent, for tests. */
  readonly sent: ChainCall[];
}

export function fakeChain(options: { manual?: boolean; contract?: Address } = {}): FakeChain {
  const signer = '0x00000000000000000000000000000000005191e5' as Address;
  const contract = (options.contract ?? '0x000000000000000000000000000000000000f00d') as Address;
  const balances = new Map<string, bigint>();
  const used = new Set<Hex>();
  const effects = new Map<Hex, Effect>();
  const rates = new Map<string, bigint>();
  const bonusRules = new Map<Hex, { pencePerBlock: bigint; weeklyCapPence: bigint }>();
  const weeks = new Map<string, number>();
  const weekOf = (child: Address) => weeks.get(child.toLowerCase()) ?? 0;
  const receipts = new Map<Hex, Receipt>();
  const events: ChainEvent[] = [];
  const sent: ChainCall[] = [];
  let pending: Pending[] = [];
  let block = 0;
  let nonce = 0;

  const key = (child: Address, id: bigint) => `${child.toLowerCase()}:${id}`;
  const bal = (child: Address, id: bigint) => balances.get(key(child, id)) ?? 0n;
  const refuse = (reason: string, message = reason): never => {
    throw new ChainRefusal(reason, message);
  };

  /** Applies a call to a copy of the state, or refuses; returns the event and the state to keep. */
  function apply(call: ChainCall) {
    const next = new Map(balances);
    const add = (child: Address, id: bigint, amount: bigint) => {
      const now = next.get(key(child, id)) ?? 0n;
      if (now + amount < 0n) refuse('ERC1155InsufficientBalance', `Not enough of token ${id} for ${child}`);
      next.set(key(child, id), now + amount);
    };
    const fresh = (ref: Hex) => {
      if (used.has(ref)) refuse('RefUsed');
    };
    const positive = (n: bigint) => {
      if (n <= 0n) refuse('ZeroAmount');
    };
    const tokenOk = (id: bigint) => {
      if (id !== TOKEN.TIME && id !== TOKEN.MONEY && id !== TOKEN.FLEX) refuse('WrongToken');
    };
    let effect: (Effect & { ref: Hex }) | null = null;
    let reversedRef: Hex | null = null;
    let closedFor: Address | null = null;
    let event: { name: string; args: Record<string, unknown> };
    const record = (ref: Hex, child: Address, time: bigint, money: bigint, flex: bigint, reversible: boolean) => {
      effect = { ref, child, time, money, flex, week: weekOf(child), reversible, reversed: false };
    };
    const split = (id: bigint, n: bigint): [bigint, bigint, bigint] => [id === TOKEN.TIME ? n : 0n, id === TOKEN.MONEY ? n : 0n, id === TOKEN.FLEX ? n : 0n];

    switch (call.fn) {
      case 'allocateAllowance': {
        const [ref, child, mins, at] = call.args;
        fresh(ref);
        add(child, TOKEN.TIME, mins);
        record(ref, child, mins, 0n, 0n, false);
        event = { name: 'AllowanceAllocated', args: { ref, child, mins, at } };
        break;
      }
      case 'award': {
        const [ref, child, id, amount, at] = call.args;
        fresh(ref);
        tokenOk(id);
        positive(amount);
        add(child, id, amount);
        record(ref, child, ...split(id, amount), true);
        event = { name: 'TaskRewarded', args: { ref, child, id, amount, at } };
        break;
      }
      case 'spendTime': {
        const [ref, child, mins, at] = call.args;
        fresh(ref);
        positive(mins);
        add(child, TOKEN.TIME, -mins);
        record(ref, child, -mins, 0n, 0n, false);
        event = { name: 'TimeSpent', args: { ref, child, mins, at } };
        break;
      }
      case 'refund': {
        const [ref, child, id, amount, chosen, at] = call.args;
        fresh(ref);
        tokenOk(id);
        if (!chosen && id !== TOKEN.TIME) refuse('WrongToken');
        positive(amount);
        add(child, id, amount);
        record(ref, child, ...split(id, amount), chosen);
        event = { name: 'Refunded', args: { ref, child, id, amount, chosen, at } };
        break;
      }
      case 'convert': {
        const [ref, household, child, points, toId, amount, at] = call.args;
        fresh(ref);
        if (toId !== TOKEN.MONEY && toId !== TOKEN.TIME) refuse('WrongToken');
        positive(points);
        const each = rates.get(`${household}:${toId}`) ?? 0n;
        if (each === 0n) refuse('NoRate');
        if (amount !== points * each) refuse('WrongRate');
        add(child, TOKEN.FLEX, -points);
        add(child, toId, amount);
        const [t, m] = split(toId, amount);
        record(ref, child, t, m, -points, true);
        event = { name: 'Converted', args: { ref, child, household, points, toId, amount, at } };
        break;
      }
      case 'closeWeek': {
        const [ref, household, child, expiredMinutes, bonusPence, at] = call.args;
        fresh(ref);
        const rule = bonusRules.get(household) ?? { pencePerBlock: 0n, weeklyCapPence: 0n };
        let allowed = (expiredMinutes / 30n) * rule.pencePerBlock;
        if (allowed > rule.weeklyCapPence) allowed = rule.weeklyCapPence;
        if (bonusPence > allowed) refuse('BonusTooHigh');
        closedFor = child;
        add(child, TOKEN.TIME, -expiredMinutes);
        add(child, TOKEN.MONEY, bonusPence);
        record(ref, child, -expiredMinutes, bonusPence, 0n, false);
        event = { name: 'WeekClosed', args: { ref, child, household, expiredMinutes, bonusPence, at } };
        break;
      }
      case 'recordPayout': {
        const [ref, child, pence, at] = call.args;
        fresh(ref);
        positive(pence);
        add(child, TOKEN.MONEY, -pence);
        record(ref, child, 0n, -pence, 0n, true);
        event = { name: 'PayoutRecorded', args: { ref, child, pence, at } };
        break;
      }
      case 'reverse': {
        const [ref, original, at] = call.args;
        fresh(ref);
        const e = effects.get(original);
        if (!e?.reversible) refuse('NotReversible');
        if (e!.reversed) refuse('AlreadyReversed');
        if (e!.time > 0n && weekOf(e!.child) !== e!.week) refuse('WeekAlreadyClosed');
        add(e!.child, TOKEN.TIME, -e!.time);
        add(e!.child, TOKEN.MONEY, -e!.money);
        add(e!.child, TOKEN.FLEX, -e!.flex);
        reversedRef = original;
        record(ref, e!.child, -e!.time, -e!.money, -e!.flex, false);
        event = { name: 'Reversed', args: { ref, child: e!.child, original, time: -e!.time, money: -e!.money, flex: -e!.flex, at } };
        break;
      }
      case 'setRate': {
        const [household, id, amount] = call.args;
        if (id !== TOKEN.MONEY && id !== TOKEN.TIME) refuse('WrongToken');
        return { next, commit: () => rates.set(`${household}:${id}`, amount), event: { name: 'RateSet', args: { household, id, amount } } };
      }
      case 'setBonusRule': {
        const [household, pencePerBlock, weeklyCapPence] = call.args;
        return { next, commit: () => bonusRules.set(household, { pencePerBlock, weeklyCapPence }), event: { name: 'BonusRuleSet', args: { household, pencePerBlock, weeklyCapPence } } };
      }
    }
    const e = effect as (Effect & { ref: Hex }) | null;
    const r = reversedRef as Hex | null;
    const closed = closedFor as Address | null;
    return {
      next,
      commit: () => {
        if (!e) return;
        used.add(e.ref);
        effects.set(e.ref, { child: e.child, time: e.time, money: e.money, flex: e.flex, week: e.week, reversible: e.reversible, reversed: false });
        if (r) effects.get(r)!.reversed = true;
        if (closed) weeks.set(closed.toLowerCase(), weekOf(closed) + 1);
      },
      event: event!,
    };
  }

  const chain: FakeChain = {
    signer,
    contract,
    sent,
    async send(call) {
      const p = { hash: keccak256(toBytes(`tx:${nonce}:${sent.length}`)), nonce: nonce++, call };
      pending.push(p);
      sent.push(call);
      if (!options.manual) chain.mine();
      return { hash: p.hash, nonce: p.nonce };
    },
    mine() {
      for (const p of pending) {
        block++;
        try {
          const r = apply(p.call);
          balances.clear();
          for (const [k, v] of r.next) balances.set(k, v);
          r.commit();
          events.push({ ...r.event, blockNumber: block, logIndex: 0, txHash: p.hash });
          receipts.set(p.hash, { status: 'success', blockNumber: block });
        } catch (err) {
          receipts.set(p.hash, { status: 'reverted', blockNumber: block, reason: err instanceof ChainRefusal ? err.reason : String(err) });
        }
      }
      pending = [];
    },
    dropPending() {
      nonce -= pending.length;
      pending = [];
    },
    async receipt(hash) {
      return receipts.get(hash) ?? null;
    },
    async pendingNonce() {
      return nonce;
    },
    async blockNumber() {
      return block;
    },
    async events(fromBlock, toBlock) {
      return events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
    },
    async balanceOf(child, id) {
      return bal(child, id);
    },
    async rate(household, id) {
      return rates.get(`${household}:${id}`) ?? 0n;
    },
    async bonusRule(household) {
      return bonusRules.get(household) ?? { pencePerBlock: 0n, weeklyCapPence: 0n };
    },
  };
  return chain;
}
