// The economy's clockwork, run every minute by the worker. Everything here is idempotent through
// ledger references, so a missed minute, a restart or a second run changes nothing:
//   - the week close at the household's reset, catching up if the server was down at that moment
//     (bonus, then the rest of the time expires, then an agreed reduction step, then the allowance)
//   - planned sessions that have ended: minutes a parent's Block or Pause took back are refunded
//   - Allows that count in weekly time and have ended: the minutes they ran are charged
//   - the nightly walk of the ledger's hash chain
import { allowances, goals, grants, households, ledgerEntries, loadEconomy, overrides, people, reductionPlans, serviceGroupMembers, settings, type Db } from '@family-time/db';
import { allowCharge, civilDate, isoDate, localParts, minutesLost, nextAllowance, weekStarting, type Span } from '@family-time/domain';
import type { LedgerPort } from '@family-time/ledger';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { Log } from './worker.js';

export interface EconomyDeps {
  db: Db;
  ledger: LedgerPort;
  now: () => Date;
  log: Log;
  /** Tells the owner the ledger's chain is broken. */
  onChainBroken?: (householdId: string, problem: string) => Promise<void>;
}

export interface EconomyResult {
  closed: number;
  allocated: number;
  refunds: number;
  charges: number;
  verified?: boolean;
}

/** The household setting holding the last date the chain was walked. */
const SETTING_VERIFIED_ON = 'ledger_verified_on';
/** And the last entry it found, so entries removed from the end show up the next night. */
const SETTING_HEAD = 'ledger_head';
/** The chain is walked once a day, after this local hour, when the house is quiet. */
const VERIFY_AFTER_HOUR = 3;

/** "6 h 30", "7 h". */
const hours = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`;
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export async function economyTick(deps: EconomyDeps): Promise<EconomyResult> {
  const { db, log } = deps;
  const now = deps.now();
  const result: EconomyResult = { closed: 0, allocated: 0, refunds: 0, charges: 0 };
  for (const hh of await db.select().from(households)) {
    const children = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.householdId, hh.id), eq(people.role, 'child'), eq(people.active, true)));
    for (const c of children) {
      const e = await loadEconomy(db, c.id);
      if (!e.features.economy) continue;
      try {
        // Sessions and Allows first, so the week's close counts them in the week they belong to.
        await settleSessions(deps, e.householdId, e.childId, now, result);
        await chargeAllows(deps, e.householdId, e.childId, now, result);
        await weekTurn(deps, e.childId, now, result);
      } catch (err) {
        log('error', 'economy_failed', { child: c.id, error: (err as Error).message });
      }
    }
    const verified = await nightlyVerify(deps, hh.id, hh.timezone, now);
    if (verified !== undefined) result.verified = verified;
  }
  return result;
}

/** Closes the last week the child had, then gives this week's allowance. Both once only. */
async function weekTurn(deps: EconomyDeps, childId: string, now: Date, result: EconomyResult) {
  const { db, ledger } = deps;
  const e = await loadEconomy(db, childId);
  const week = weekStarting(now, e.weekReset, e.timeZone);
  const allowanceRef = `allowance:${childId}:${week.date}`;
  const given = await db
    .select({ ref: ledgerEntries.ref })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.householdId, e.householdId), eq(ledgerEntries.ref, allowanceRef)));
  if (given.length) return;

  // The last week this child had an allowance: close it at its own boundary, if not closed yet.
  const last = (
    await db
      .select({ data: ledgerEntries.data })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.childId, childId), eq(ledgerEntries.kind, 'allowance')))
      .orderBy(desc(ledgerEntries.seq))
      .limit(1)
  )[0];
  const lastWeek = (last?.data as { week?: string } | undefined)?.week;
  if (lastWeek) {
    const closesAt = weekStarting(new Date(new Date(`${lastWeek}T12:00:00Z`).getTime() + 3 * 86_400_000), e.weekReset, e.timeZone).next;
    await ledger.closeWeek({
      ref: `close:${childId}:${lastWeek}`,
      householdId: e.householdId,
      childId,
      reason: e.features.bonus ? `Week from ${dateLabel(lastWeek)} ended: unused time became pocket money` : `Week from ${dateLabel(lastWeek)} ended: unused time doesn't carry over`,
      at: closesAt,
      // As it stood at the reset: anything given after it belongs to the new week.
      asOf: closesAt,
      bonus: e.features.bonus ? e.rates.bonus : null,
      data: { week: lastWeek },
    });
    result.closed++;
    await matchWeek(deps, e, lastWeek, closesAt);
  }

  // This week's allowance, after a reduction step if one is due and was agreed.
  const step = nextAllowance(e.allowanceMinutes, e.features.taper ? e.plan : null, week.date);
  if (step.stepped && step.plan) {
    await db
      .insert(allowances)
      .values({ childId, weeklyMinutes: step.minutes, updatedAt: now })
      .onConflictDoUpdate({ target: allowances.childId, set: { weeklyMinutes: step.minutes, updatedAt: now } });
    await db.update(reductionPlans).set({ nextStepOn: step.plan.nextStepOn, agreedStepOn: null, agreedBy: null, agreedAt: null, updatedAt: now }).where(eq(reductionPlans.childId, childId));
  }
  await ledger.allocateAllowance({
    ref: allowanceRef,
    householdId: e.householdId,
    childId,
    reason: step.stepped ? `Weekly time from ${dateLabel(week.date)}, ${hours(step.minutes)} after the agreed step` : `Weekly time from ${dateLabel(week.date)}`,
    at: week.start,
    minutes: step.minutes,
    data: { week: week.date, stepped: step.stepped },
  });
  result.allocated++;
}

/**
 * Parental matching on the savings goal (brief Part 6): after a week closes, the parents add their
 * percent of the pocket money the child earned in it, as their own MONEY award. Never more than the
 * goal still needs, never a deduction, and once a week through its reference.
 */
async function matchWeek(deps: EconomyDeps, e: Awaited<ReturnType<typeof loadEconomy>>, week: string, closesAt: Date) {
  const g = e.goal;
  if (!g || !g.matchPercent || !e.features.goal) return;
  const { db, ledger } = deps;
  const start = weekStarting(new Date(`${week}T12:00:00Z`), e.weekReset, e.timeZone).start;
  const created = (await db.select({ at: goals.createdAt }).from(goals).where(eq(goals.id, g.id)))[0]?.at ?? start;
  const from = created > start ? created : start;
  const entries = (await ledger.history(e.householdId, e.childId, { since: from, limit: 5000 })).filter((x) => x.at <= closesAt);
  // Earned, net of corrections, as the goal's bar counts it: payouts and the parents' own matches aside.
  const left = new Set(entries.filter((x) => x.kind === 'payout' || x.ref.startsWith('match:')).map((x) => x.ref));
  const earned = Math.max(0, entries.filter((x) => !left.has(x.ref) && !(x.kind === 'reversal' && left.has(String(x.data.reverses)))).reduce((n, x) => n + x.money, 0));
  const saved = await savedTowards(ledger, e.householdId, e.childId, created);
  const amount = Math.min(Math.floor((earned * g.matchPercent) / 100), Math.max(0, g.targetPence - saved));
  if (amount <= 0) return;
  await ledger.award({
    ref: `match:${e.childId}:${week}`,
    householdId: e.householdId,
    childId: e.childId,
    reason: `Matched by Mum and Dad: ${g.matchPercent}% towards ${g.title}`,
    at: closesAt,
    currency: 'MONEY',
    amount,
    data: { week, goal: g.id, matchPercent: g.matchPercent },
  });
}

/** What the goal's bar shows: pocket money earned since it was set, payouts not taken off. */
async function savedTowards(ledger: LedgerPort, householdId: string, childId: string, since: Date): Promise<number> {
  const entries = await ledger.history(householdId, childId, { since, limit: 5000 });
  const payouts = new Set(entries.filter((x) => x.kind === 'payout').map((x) => x.ref));
  return entries.filter((x) => x.kind !== 'payout' && !(x.kind === 'reversal' && payouts.has(String(x.data.reverses)))).reduce((n, x) => n + x.money, 0);
}

/** Overrides that stopped this target: Blocks and Pauses on it, its group, or everything. */
async function stoppingSpans(db: Db, childId: string, target: { kind: 'service' | 'group'; id: string }, from: Date, to: Date): Promise<Span[]> {
  const groupIds = target.kind === 'service' ? (await db.select({ id: serviceGroupMembers.groupId }).from(serviceGroupMembers).where(eq(serviceGroupMembers.serviceId, target.id))).map((g) => g.id) : [];
  const rows = await db
    .select({ start: overrides.startsAt, end: overrides.endsAt, kind: overrides.targetKind, id: overrides.targetId })
    .from(overrides)
    .where(and(eq(overrides.childId, childId), inArray(overrides.type, ['block', 'pause']), lte(overrides.startsAt, to), or(gt(overrides.endsAt, from), isNull(overrides.endsAt))));
  return rows
    .filter((o) => o.kind === 'everything' || o.id === target.id || (o.kind === 'group' && groupIds.includes(o.id!)))
    .map((o) => ({ start: o.start, end: o.end }));
}

/** Sessions that have ended: refund what a parent took back, then mark them ended. */
async function settleSessions(deps: EconomyDeps, householdId: string, childId: string, now: Date, result: EconomyResult) {
  const { db, ledger } = deps;
  const due = await db
    .select()
    .from(grants)
    .where(and(eq(grants.childId, childId), lte(grants.endsAt, now), inArray(grants.status, ['scheduled', 'active', 'paused'])));
  for (const g of due) {
    // Only time that came from the allowance goes back: a session approved as extra cost nothing.
    const spent = (await db.select({ ref: ledgerEntries.ref }).from(ledgerEntries).where(and(eq(ledgerEntries.householdId, householdId), eq(ledgerEntries.ref, `grant:${g.id}`)))).length > 0;
    if (spent) {
      const lost = minutesLost({ start: g.startsAt, end: g.endsAt }, await stoppingSpans(db, childId, { kind: g.targetKind, id: g.targetId }, g.startsAt, g.endsAt));
      if (lost > 0) {
        await ledger.refund({ ref: `refund:grant:${g.id}`, householdId, childId, reason: 'Planned time given back after a parent stopped it', at: g.endsAt, currency: 'TIME', amount: lost, data: { grantId: g.id } });
        result.refunds++;
      }
    }
    await db.update(grants).set({ status: 'ended' }).where(eq(grants.id, g.id));
  }
}

/** Allows that counted in weekly time and have ended this week: charge the minutes they ran. */
async function chargeAllows(deps: EconomyDeps, householdId: string, childId: string, now: Date, result: EconomyResult) {
  const { db, ledger } = deps;
  const e = await loadEconomy(db, childId);
  const week = weekStarting(now, e.weekReset, e.timeZone);
  const ended = await db
    .select()
    .from(overrides)
    .where(
      and(
        eq(overrides.childId, childId),
        eq(overrides.type, 'allow'),
        eq(overrides.countsAgainstAllowance, true),
        isNotNull(overrides.endsAt),
        lte(overrides.endsAt, now),
        gt(overrides.endsAt, new Date(week.start.getTime() - 7 * 86_400_000)),
      ),
    );
  for (const o of ended) {
    const ref = `allow:${o.id}`;
    if ((await db.select({ ref: ledgerEntries.ref }).from(ledgerEntries).where(and(eq(ledgerEntries.householdId, householdId), eq(ledgerEntries.ref, ref)))).length) continue;
    // Counted within the week it ended in: from that week's start, if it began the week before.
    const endedIn = weekStarting(o.endsAt!, e.weekReset, e.timeZone).start;
    const start = o.startsAt.getTime() < endedIn.getTime() ? endedIn : o.startsAt;
    const minutes = allowCharge(start, o.endsAt!, (await ledger.balances(householdId, childId)).time);
    if (minutes > 0) {
      await ledger.spendTime({ ref, householdId, childId, reason: 'Extra time a parent allowed, counted in weekly time', at: o.endsAt!, minutes, by: o.createdBy, data: { overrideId: o.id } });
      result.charges++;
    }
  }
}

/** Once a day, in the small hours: walk the chain; a break is the owner's to know about at once. */
async function nightlyVerify(deps: EconomyDeps, householdId: string, timeZone: string, now: Date): Promise<boolean | undefined> {
  const { db, ledger, log } = deps;
  const local = localParts(now, timeZone);
  if (local.hour < VERIFY_AFTER_HOUR) return undefined;
  const stamp = isoDate(civilDate(now, timeZone));
  const done = (await db.select({ value: settings.value }).from(settings).where(and(eq(settings.householdId, householdId), eq(settings.key, SETTING_VERIFIED_ON))))[0];
  if (done?.value === stamp) return undefined;
  const v = await ledger.verify(householdId);
  // The head from last night: the chain may only grow, and what was there must not change.
  const before = (await db.select({ value: settings.value }).from(settings).where(and(eq(settings.householdId, householdId), eq(settings.key, SETTING_HEAD))))[0]?.value as { seq: number; hash: string } | undefined;
  if (v.ok && before) {
    if (!v.head || v.head.seq < before.seq) {
      v.ok = false;
      v.problem = `The history is shorter than last night: ${before.seq} entries then, ${v.head?.seq ?? 0} now.`;
    } else {
      const then = (await db.select({ hash: ledgerEntries.hash }).from(ledgerEntries).where(and(eq(ledgerEntries.householdId, householdId), eq(ledgerEntries.seq, before.seq))))[0];
      if (then?.hash !== before.hash) {
        v.ok = false;
        v.problem = `Entry ${before.seq} is not the one it was last night.`;
      }
    }
  }
  const save = async (key: string, value: unknown) =>
    db
      .insert(settings)
      .values({ householdId, key, value, updatedAt: now })
      .onConflictDoUpdate({ target: [settings.householdId, settings.key], set: { value, updatedAt: now } });
  if (v.ok && v.head) await save(SETTING_HEAD, v.head);
  await save(SETTING_VERIFIED_ON, stamp);
  if (v.ok) {
    log('info', 'ledger_verified', { entries: v.checked });
  } else {
    log('error', 'ledger_chain_broken', { brokenAt: v.brokenAt, problem: v.problem });
    await deps.onChainBroken?.(householdId, v.problem ?? 'The ledger chain does not check out.');
  }
  return v.ok;
}
