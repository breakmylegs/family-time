// The economy's clockwork, run every minute by the worker. Everything here is idempotent through
// ledger references, so a missed minute, a restart or a second run changes nothing:
//   - the week close at the household's reset, catching up if the server was down at that moment
//     (bonus, then the rest of the time expires, then an agreed reduction step, then the allowance)
//   - planned sessions that have ended: minutes a parent's Block or Pause took back are refunded
//   - Allows that count in weekly time and have ended: the minutes they ran are charged
//   - the nightly walk of the ledger's hash chain
import { allowances, grants, households, ledgerEntries, loadEconomy, overrides, people, reductionPlans, serviceGroupMembers, settings, type Db } from '@family-time/db';
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
/** The chain is walked once a day, after this local hour, when the house is quiet. */
const VERIFY_AFTER_HOUR = 3;

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
        await weekTurn(deps, e.childId, now, result);
        await settleSessions(deps, e.householdId, e.childId, now, result);
        await chargeAllows(deps, e.householdId, e.childId, now, result);
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
      reason: `Unused time, week of ${dateLabel(lastWeek)}`,
      at: closesAt,
      bonus: e.features.bonus ? e.rates.bonus : null,
      data: { week: lastWeek },
    });
    result.closed++;
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
    reason: step.stepped ? `This week's time, ${step.minutes} minutes after the agreed step` : `This week's time`,
    at: week.start,
    minutes: step.minutes,
    data: { week: week.date, stepped: step.stepped },
  });
  result.allocated++;
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
        await ledger.refund({ ref: `refund:grant:${g.id}`, householdId, childId, reason: 'Planned time a parent paused', at: g.endsAt, currency: 'TIME', amount: lost, data: { grantId: g.id } });
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
        gt(overrides.endsAt, week.start),
      ),
    );
  for (const o of ended) {
    const ref = `allow:${o.id}`;
    if ((await db.select({ ref: ledgerEntries.ref }).from(ledgerEntries).where(and(eq(ledgerEntries.householdId, householdId), eq(ledgerEntries.ref, ref)))).length) continue;
    // Counted from when this week began, if it started last week.
    const start = o.startsAt.getTime() < week.start.getTime() ? week.start : o.startsAt;
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
  await db
    .insert(settings)
    .values({ householdId, key: SETTING_VERIFIED_ON, value: stamp, updatedAt: now })
    .onConflictDoUpdate({ target: [settings.householdId, settings.key], set: { value: stamp, updatedAt: now } });
  if (v.ok) {
    log('info', 'ledger_verified', { entries: v.checked });
  } else {
    log('error', 'ledger_chain_broken', { brokenAt: v.brokenAt, problem: v.problem });
    await deps.onChainBroken?.(householdId, v.problem ?? 'The ledger chain does not check out.');
  }
  return v.ok;
}
