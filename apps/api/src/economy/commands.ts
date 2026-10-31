// The economy's actions, shared by the api routes, the command line and (Phase 6) the kiosk. They
// decide with the domain's rules, record on the ledger, and keep the tables beside it in step.
// The child's side (plan, log a job, ask) is here too; only its screens wait for the kiosk.
import {
  allowances,
  completions,
  goals,
  grants,
  households,
  loadEconomy,
  loadRules,
  people,
  policies,
  reductionPlans,
  requests,
  serviceGroupMembers,
  serviceGroups,
  services,
  tasks,
  type Db,
} from '@family-time/db';
import { blocksOn, checkPlan, civilDate, clockLabel, earnedTimeCap, timeAwardable, weekStarting, zonedTime, type Features } from '@family-time/domain';
import { LedgerError, type LedgerEntry, type LedgerPort } from '@family-time/ledger';
import type { ApprovalItem, LedgerLine, Recurrence, Task, TaskInput, WeekSummary } from '@family-time/schemas';
import { and, asc, eq, gt, gte, inArray, or, sql } from 'drizzle-orm';
import { audit } from '../audit.js';
import { minutes, pence, points, pronounsOf, rewardLabel, suggestions, when } from './words.js';

export class EconomyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** How long after a decision its Undo still works. The toast shows for 10 seconds. */
const UNDO_MS = 60_000;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function needEconomy(f: Features) {
  if (!f.economy) throw new EconomyError('not_yet', "The weekly allowance and jobs aren't switched on yet. The owner turns them on when the family is ready.", 409);
}

/** Turns a ledger refusal into words for a parent. */
function fromLedger(err: unknown): never {
  if (err instanceof LedgerError) throw new EconomyError(err.code, err.message, err.code === 'not_found' ? 404 : 409);
  throw err;
}

// ---------------------------------------------------------------------------------------------
// The week at a glance

/** Screen time earned from jobs and flex this week, which the 15% cap counts. */
function earnedThisWeek(entries: LedgerEntry[]): number {
  return entries.filter((x) => (x.kind === 'award' || x.kind === 'convert') && x.time > 0).reduce((n, x) => n + x.time, 0);
}

export async function weekSummary(db: Db, ledger: LedgerPort, childId: string, now: Date): Promise<WeekSummary> {
  const e = await loadEconomy(db, childId);
  const week = weekStarting(now, e.weekReset, e.timeZone);
  const [balance, thisWeek, history] = await Promise.all([
    ledger.balances(e.householdId, childId),
    ledger.history(e.householdId, childId, { since: week.start }),
    ledger.history(e.householdId, childId, { limit: 50 }),
  ]);
  const allowanceEntry = thisWeek.find((x) => x.kind === 'allowance');
  const allowance = allowanceEntry?.time ?? e.allowanceMinutes;
  const spentRefs = new Set(thisWeek.filter((x) => x.kind === 'spend').map((x) => x.ref));
  const future = await db
    .select({ id: grants.id, start: grants.startsAt, end: grants.endsAt })
    .from(grants)
    .where(and(eq(grants.childId, childId), gt(grants.startsAt, now), inArray(grants.status, ['scheduled', 'active'])));
  const planned = future.filter((g) => spentRefs.has(`grant:${g.id}`)).reduce((n, g) => n + Math.round((g.end.getTime() - g.start.getTime()) / 60_000), 0);
  const spent = -thisWeek.filter((x) => x.kind === 'spend').reduce((n, x) => n + x.time, 0);
  const refunded = thisWeek.filter((x) => x.kind === 'refund').reduce((n, x) => n + Math.max(0, x.time), 0);
  const close = history.find((x) => x.kind === 'close');
  const reset = e.weekReset;
  return {
    childId,
    features: e.features,
    allowanceMinutes: allowance,
    leftMinutes: balance.time,
    plannedMinutes: planned,
    usedMinutes: Math.max(0, spent - refunded - planned),
    earnedMinutes: earnedThisWeek(thisWeek),
    earnedCapMinutes: earnedTimeCap(e.allowanceMinutes),
    resets: `${DAYS[reset.weekday]} at ${String(Math.floor(reset.minuteOfDay / 60)).padStart(2, '0')}:${String(reset.minuteOfDay % 60).padStart(2, '0')}`,
    moneyPence: balance.money,
    flexPoints: balance.flex,
    lastWeek: close ? { minutesLeft: Number(close.data.minutesLeft ?? 0), bonusPence: Number(close.data.bonusPence ?? 0) } : null,
    nextStep: e.plan
      ? {
          minutes: Math.max(e.plan.floorMinutes, e.allowanceMinutes - e.plan.stepMinutes),
          on: e.plan.nextStepOn,
          onLabel: dateLabel(e.plan.nextStepOn),
          agreed: e.plan.agreedStepOn === e.plan.nextStepOn,
          stepMinutes: e.plan.stepMinutes,
          everyWeeks: e.plan.everyWeeks,
          floorMinutes: e.plan.floorMinutes,
        }
      : null,
    goal: e.goal ? { title: e.goal.title, targetPence: e.goal.targetPence, savedPence: Math.max(0, Math.min(balance.money, e.goal.targetPence)) } : null,
    rates: { pencePerBlock: e.rates.bonus.pencePerBlock, weeklyCapPence: e.rates.bonus.weeklyCapPence, flexPence: e.rates.flexPence, flexMinutes: e.rates.flexMinutes },
  };
}

const REVERSIBLE = new Set(['award', 'convert', 'payout', 'refund']);

function change(x: LedgerEntry): string {
  const parts: string[] = [];
  const sign = (n: number) => (n > 0 ? '+' : '');
  if (x.time) parts.push(`${sign(x.time)}${minutes(x.time)}`);
  if (x.money) parts.push(`${sign(x.money)}${pence(x.money)}`);
  if (x.flex) parts.push(`${sign(x.flex)}${points(x.flex)}`);
  return parts.join(', ') || 'No change';
}

/** The child's ledger for the Family screen, newest first. */
export async function ledgerLines(db: Db, ledger: LedgerPort, childId: string, now: Date, limit = 40): Promise<LedgerLine[]> {
  const e = await loadEconomy(db, childId);
  const entries = await ledger.history(e.householdId, childId, { limit });
  const reversed = new Set(entries.filter((x) => x.kind === 'reversal').map((x) => String(x.data.reverses)));
  return entries.map((x) => ({
    ref: x.ref,
    kind: x.kind,
    at: x.at.toISOString(),
    when: when(x.at, now, e.timeZone),
    reason: x.reason,
    change: change(x),
    reversible: REVERSIBLE.has(x.kind) && !reversed.has(x.ref),
  }));
}

// ---------------------------------------------------------------------------------------------
// Jobs

function toTask(r: typeof tasks.$inferSelect): Task {
  return {
    id: r.id,
    title: r.title,
    picture: r.picture,
    rewardType: r.rewardType,
    amount: r.amount,
    recurrence: r.recurrence as Recurrence,
    ageBand: r.ageBand,
    needsPhoto: r.needsPhoto,
    childId: r.childId,
    active: r.active,
    rewardLabel: rewardLabel(r.rewardType, r.amount),
  };
}

export async function listTasks(db: Db, householdId: string): Promise<Task[]> {
  const rows = await db.select().from(tasks).where(and(eq(tasks.householdId, householdId), eq(tasks.active, true))).orderBy(asc(tasks.title));
  return rows.map(toTask);
}

async function checkTaskChild(db: Db, householdId: string, childId: string | null) {
  if (!childId) return;
  const c = await db.select({ id: people.id }).from(people).where(and(eq(people.id, childId), eq(people.householdId, householdId), eq(people.role, 'child')));
  if (!c.length) throw new EconomyError('not_found', "Family time can't find that child.", 404);
}

export async function createTask(db: Db, input: { householdId: string; by: string; task: TaskInput }, now: Date): Promise<Task> {
  await checkTaskChild(db, input.householdId, input.task.childId);
  const [row] = await db
    .insert(tasks)
    .values({ householdId: input.householdId, createdBy: input.by, createdAt: now, ...input.task })
    .returning();
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'task.created', targetType: 'task', targetId: row!.id, after: input.task });
  return toTask(row!);
}

export async function updateTask(db: Db, input: { householdId: string; by: string; taskId: string; task: TaskInput }): Promise<Task> {
  await checkTaskChild(db, input.householdId, input.task.childId);
  const [row] = await db
    .update(tasks)
    .set(input.task)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.householdId, input.householdId), eq(tasks.active, true)))
    .returning();
  if (!row) throw new EconomyError('not_found', "That job isn't on the list any more.", 404);
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'task.updated', targetType: 'task', targetId: row.id, after: input.task });
  return toTask(row);
}

/** Jobs are archived, never deleted: completions point at them. */
export async function archiveTask(db: Db, input: { householdId: string; by: string; taskId: string }): Promise<void> {
  const rows = await db.update(tasks).set({ active: false }).where(and(eq(tasks.id, input.taskId), eq(tasks.householdId, input.householdId))).returning({ id: tasks.id });
  if (!rows.length) throw new EconomyError('not_found', "That job isn't on the list any more.", 404);
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'task.archived', targetType: 'task', targetId: input.taskId });
}

// ---------------------------------------------------------------------------------------------
// The child's side: log a job, plan a session, ask a grown-up

/** "I did it". Once a day for daily jobs, on the listed days for weekly ones, once ever for one-offs. */
export async function logCompletion(db: Db, input: { childId: string; taskId: string }, now: Date): Promise<string> {
  const e = await loadEconomy(db, input.childId);
  needEconomy(e.features);
  const task = (await db.select().from(tasks).where(and(eq(tasks.id, input.taskId), eq(tasks.householdId, e.householdId), eq(tasks.active, true))))[0];
  if (!task || (task.childId && task.childId !== input.childId)) throw new EconomyError('not_found', "That job isn't on your list.", 404);
  const today = civilDate(now, e.timeZone);
  const midnight = zonedTime(today.year, today.month, today.day, 0, e.timeZone);
  const rec = task.recurrence as Recurrence;
  if (rec.kind === 'weekly' && !rec.weekdays.includes(new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay())) {
    throw new EconomyError('not_today', "That job isn't for today.", 409);
  }
  const earlier = await db
    .select({ id: completions.id })
    .from(completions)
    .where(
      and(
        eq(completions.taskId, task.id),
        eq(completions.childId, input.childId),
        inArray(completions.status, ['waiting', 'approved']),
        rec.kind === 'once' ? sql`true` : gte(completions.loggedAt, midnight),
      ),
    );
  if (earlier.length) throw new EconomyError('done', rec.kind === 'once' ? "You've already done that one." : "You've already done that one today.", 409);
  const [row] = await db.insert(completions).values({ taskId: task.id, childId: input.childId, loggedAt: now }).returning({ id: completions.id });
  return row!.id;
}

/** Policy caps for a target: the service's own, or its group's. */
async function capsFor(db: Db, childId: string, target: { kind: 'service' | 'group'; id: string }) {
  const groupIds =
    target.kind === 'service' ? (await db.select({ id: serviceGroupMembers.groupId }).from(serviceGroupMembers).where(eq(serviceGroupMembers.serviceId, target.id))).map((g) => g.id) : [target.id];
  const rows = await db
    .select()
    .from(policies)
    .where(and(eq(policies.childId, childId), or(target.kind === 'service' ? eq(policies.serviceId, target.id) : sql`false`, groupIds.length ? inArray(policies.groupId, groupIds) : sql`false`)));
  const own = rows.find((p) => p.serviceId === target.id) ?? rows[0];
  return { daily: own?.dailyCapMinutes ?? null, session: own?.sessionCapMinutes ?? null, earnable: rows.every((p) => p.earnable) };
}

async function targetName(db: Db, householdId: string, target: { kind: 'service' | 'group'; id: string }): Promise<string> {
  const table = target.kind === 'service' ? services : serviceGroups;
  const row = (await db.select({ name: table.name }).from(table).where(and(eq(table.id, target.id), eq(table.householdId, householdId))))[0];
  if (!row) throw new EconomyError('unknown_target', "That app isn't on your family's list.", 404);
  return row.name;
}

/** Checks a session against the rules, for planning and for approving a request. */
async function sessionCheck(db: Db, ledger: LedgerPort, input: { childId: string; target: { kind: 'service' | 'group'; id: string }; start: Date; minutes: number; asExtra?: boolean }, now: Date) {
  const e = await loadEconomy(db, input.childId);
  const rules = await loadRules(db, input.childId, now);
  const today = civilDate(now, e.timeZone);
  const midnight = zonedTime(today.year, today.month, today.day, 0, e.timeZone);
  const end = new Date(input.start.getTime() + input.minutes * 60_000);
  const same = await db
    .select({ start: grants.startsAt, end: grants.endsAt })
    .from(grants)
    .where(and(eq(grants.childId, input.childId), eq(grants.targetKind, input.target.kind), eq(grants.targetId, input.target.id), inArray(grants.status, ['scheduled', 'active']), gte(grants.endsAt, midnight)));
  const caps = await capsFor(db, input.childId, input.target);
  const balance = await ledger.balances(e.householdId, input.childId);
  const result = checkPlan({
    schedules: rules.schedules,
    childId: input.childId,
    timeZone: e.timeZone,
    now,
    start: input.start,
    minutes: input.minutes,
    balanceMinutes: input.asExtra ? Number.MAX_SAFE_INTEGER : balance.time,
    plannedToday: same.reduce((n, g) => n + Math.round((g.end.getTime() - g.start.getTime()) / 60_000), 0),
    dailyCapMinutes: caps.daily,
    sessionCapMinutes: caps.session,
    overlapsOwn: same.some((g) => g.start.getTime() < end.getTime() && input.start.getTime() < g.end.getTime()),
  });
  return { e, result, balance, end };
}

/** Plan my time: a grant for the session, its TIME spent at once. */
export async function planSession(db: Db, ledger: LedgerPort, input: { childId: string; target: { kind: 'service' | 'group'; id: string }; start: Date; minutes: number }, now: Date): Promise<string> {
  const { e, result, end } = await sessionCheck(db, ledger, input, now);
  needEconomy(e.features);
  await targetName(db, e.householdId, input.target);
  if (!result.ok) throw new EconomyError('cannot_plan', result.reason, 409);
  const [g] = await db
    .insert(grants)
    .values({ householdId: e.householdId, childId: input.childId, targetKind: input.target.kind, targetId: input.target.id, startsAt: input.start, endsAt: end, source: 'planned', status: 'scheduled', createdAt: now })
    .returning({ id: grants.id });
  try {
    await ledger.spendTime({ ref: `grant:${g!.id}`, householdId: e.householdId, childId: input.childId, reason: 'Planned screen time', at: now, minutes: input.minutes, data: { grantId: g!.id } });
  } catch (err) {
    // Two plans racing for the last minutes: the one that lost leaves no grant behind.
    await db.delete(grants).where(eq(grants.id, g!.id));
    fromLedger(err);
  }
  return g!.id;
}

/** Ask a grown-up: time outside the plan, for a parent to decide. */
export async function askRequest(db: Db, input: { childId: string; target: { kind: 'service' | 'group'; id: string }; start: Date; minutes: number; detail?: string | null }, now: Date): Promise<string> {
  const e = await loadEconomy(db, input.childId);
  needEconomy(e.features);
  await targetName(db, e.householdId, input.target);
  if (input.minutes <= 0 || input.minutes % 30) throw new EconomyError('invalid', 'Ask in blocks of 30 minutes.');
  const [row] = await db
    .insert(requests)
    .values({ childId: input.childId, targetKind: input.target.kind, targetId: input.target.id, startsAt: input.start, minutes: input.minutes, detail: input.detail?.trim().slice(0, 200) || null, askedAt: now })
    .returning({ id: requests.id });
  return row!.id;
}

// ---------------------------------------------------------------------------------------------
// Approvals

export async function approvalsFor(db: Db, ledger: LedgerPort, householdId: string, now: Date): Promise<ApprovalItem[]> {
  const kids = await db
    .select({ id: people.id, name: people.displayName, pronouns: people.pronouns })
    .from(people)
    .where(and(eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)));
  if (!kids.length) return [];
  const kid = new Map(kids.map((k) => [k.id, k]));
  const out: (ApprovalItem & { sortAt: number })[] = [];

  const waiting = await db
    .select({ c: completions, t: tasks })
    .from(completions)
    .innerJoin(tasks, eq(tasks.id, completions.taskId))
    .where(and(inArray(completions.childId, [...kid.keys()]), eq(completions.status, 'waiting')));
  for (const { c, t } of waiting) {
    const e = await loadEconomy(db, c.childId);
    let willPay: { amount: number; label: string } | null = null;
    let capNote: string | null = null;
    if (t.rewardType !== 'praise') {
      let amount = t.amount;
      if (t.rewardType === 'time') {
        const week = weekStarting(now, e.weekReset, e.timeZone);
        const earned = earnedThisWeek(await ledger.history(e.householdId, c.childId, { since: week.start }));
        amount = timeAwardable(t.amount, earned, e.allowanceMinutes);
        if (amount < t.amount) {
          capNote = amount
            ? `Only ${minutes(amount)} of this week's earned screen time is left, so approving pays ${minutes(amount)}.`
            : "This week's earned screen time is used up, so approving pays nothing. You could send praise instead.";
        }
      }
      willPay = { amount, label: rewardLabel(t.rewardType, amount) };
    }
    out.push({
      kind: 'completion',
      id: c.id,
      childId: c.childId,
      childName: kid.get(c.childId)!.name,
      title: t.title,
      when: when(c.loggedAt, now, e.timeZone),
      reward: { type: t.rewardType, amount: t.amount, label: rewardLabel(t.rewardType, t.amount) },
      willPay,
      capNote,
      hasPhoto: Boolean(c.photoPath),
      suggestions: suggestions(t.rewardType === 'praise' ? 'praise' : 'job', t.title),
      sortAt: c.loggedAt.getTime(),
    });
  }

  const asks = await db
    .select()
    .from(requests)
    .where(and(inArray(requests.childId, [...kid.keys()]), eq(requests.status, 'waiting')));
  for (const r of asks) {
    const k = kid.get(r.childId)!;
    const p = pronounsOf(k.pronouns);
    const target = { kind: r.targetKind, id: r.targetId };
    const name = await targetName(db, householdId, target).catch(() => 'an app');
    const { e, result, balance, end } = await sessionCheck(db, ledger, { childId: r.childId, target, start: r.startsAt, minutes: r.minutes }, now);
    const windowLabel = `${clockLabel(r.startsAt, now, e.timeZone)} to ${clockLabel(end, now, e.timeZone)}`;
    // The balance is the last rule checked, so a refusal about this week's time means only that.
    const extraOnly = !result.ok && /this week/.test(result.reason);
    const blockedReason = result.ok || extraOnly ? null : result.reason;
    const rules = await loadRules(db, r.childId, now);
    const wind = blocksOn(rules.schedules, r.childId, civilDate(now, e.timeZone), e.timeZone).find((b) => b.type === 'wind-down' && b.start.getTime() >= end.getTime());
    const detail =
      `Uses ${r.minutes} minutes of ${p.their} own time. ${p.They} ${p.has} ${minutes(Math.max(0, balance.time))} left this week` +
      (wind ? `, and wind-down starts at ${clockLabel(wind.start, now, e.timeZone)}.` : '.');
    out.push({
      kind: 'request',
      id: r.id,
      childId: r.childId,
      childName: k.name,
      title: r.detail ?? `${name} at ${clockLabel(r.startsAt, now, e.timeZone)}`,
      when: when(r.askedAt, now, e.timeZone),
      minutes: r.minutes,
      window: windowLabel,
      detail,
      blockedReason,
      extraOnly,
      sortAt: r.askedAt.getTime(),
    });
  }
  return out.sort((a, b) => b.sortAt - a.sortAt).map(({ sortAt: _sortAt, ...item }) => item as ApprovalItem);
}

async function completionIn(db: Db, householdId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const row = (
    await db
      .select({ c: completions, t: tasks })
      .from(completions)
      .innerJoin(tasks, eq(tasks.id, completions.taskId))
      .where(and(eq(completions.id, id), eq(tasks.householdId, householdId)))
  )[0];
  return row;
}

/** Approve a job (or send praise): pay what the job pays, within the earned-time cap, with a note. */
export async function approveCompletion(db: Db, ledger: LedgerPort, input: { householdId: string; completionId: string; by: string; note: string | null }, now: Date) {
  const found = await completionIn(db, input.householdId, input.completionId);
  if (!found) throw new EconomyError('not_found', "That isn't waiting any more.", 404);
  const { c, t } = found;
  // Only one decision wins, even if two parents tap at once.
  const won = await db
    .update(completions)
    .set({ status: 'approved', note: input.note, decidedBy: input.by, decidedAt: now })
    .where(and(eq(completions.id, c.id), eq(completions.status, 'waiting')))
    .returning({ id: completions.id });
  if (!won.length) throw new EconomyError('decided', 'Someone has already decided that one.', 409);
  const e = await loadEconomy(db, c.childId);
  let paid: { currency: 'MONEY' | 'FLEX' | 'TIME'; amount: number; ref: string } | null = null;
  if (t.rewardType !== 'praise') {
    const currency = t.rewardType === 'money' ? 'MONEY' : t.rewardType === 'flex' ? 'FLEX' : 'TIME';
    let amount = t.amount;
    if (currency === 'TIME') {
      const week = weekStarting(now, e.weekReset, e.timeZone);
      amount = timeAwardable(t.amount, earnedThisWeek(await ledger.history(e.householdId, c.childId, { since: week.start })), e.allowanceMinutes);
    }
    if (amount > 0) {
      const ref = `completion:${c.id}:${now.getTime()}`;
      try {
        await ledger.award({ ref, householdId: e.householdId, childId: c.childId, reason: t.title, at: now, by: input.by, currency, amount, data: { completionId: c.id } });
      } catch (err) {
        await db.update(completions).set({ status: 'waiting', note: null, decidedBy: null, decidedAt: null }).where(eq(completions.id, c.id));
        fromLedger(err);
      }
      paid = { currency, amount, ref };
    }
  }
  await db.update(completions).set({ paid }).where(eq(completions.id, c.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'completion.approved', targetType: 'completion', targetId: c.id, after: { paid, note: input.note } });
  return { paid };
}

export async function notYetCompletion(db: Db, input: { householdId: string; completionId: string; by: string; note: string | null }, now: Date) {
  const found = await completionIn(db, input.householdId, input.completionId);
  if (!found) throw new EconomyError('not_found', "That isn't waiting any more.", 404);
  const won = await db
    .update(completions)
    .set({ status: 'not-yet', note: input.note, decidedBy: input.by, decidedAt: now })
    .where(and(eq(completions.id, found.c.id), eq(completions.status, 'waiting')))
    .returning({ id: completions.id });
  if (!won.length) throw new EconomyError('decided', 'Someone has already decided that one.', 409);
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'completion.not_yet', targetType: 'completion', targetId: found.c.id });
}

/** Undo of Approve, Send praise or Not yet, by the same parent within a minute: back to waiting. */
export async function undoCompletion(db: Db, ledger: LedgerPort, input: { householdId: string; completionId: string; by: string }, now: Date) {
  const found = await completionIn(db, input.householdId, input.completionId);
  if (!found || found.c.status === 'waiting') throw new EconomyError('not_found', "There's nothing to undo.", 404);
  const { c } = found;
  if (c.decidedBy !== input.by || !c.decidedAt || now.getTime() - c.decidedAt.getTime() > UNDO_MS) throw new EconomyError('too_late', 'That can no longer be undone.', 409);
  const paid = c.paid as { ref: string } | null;
  if (paid) {
    const e = await loadEconomy(db, c.childId);
    await ledger.reverse({ ref: `undo:${paid.ref}`, householdId: e.householdId, childId: c.childId, reason: 'Approval undone', at: now, by: input.by, entryRef: paid.ref }).catch(fromLedger);
  }
  await db.update(completions).set({ status: 'waiting', note: null, paid: null, decidedBy: null, decidedAt: null }).where(eq(completions.id, c.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'completion.undone', targetType: 'completion', targetId: c.id });
}

async function requestIn(db: Db, householdId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return (
    await db
      .select({ r: requests })
      .from(requests)
      .innerJoin(people, eq(people.id, requests.childId))
      .where(and(eq(requests.id, id), eq(people.householdId, householdId)))
  )[0]?.r;
}

/** Yes to a request: a grant for the session, from the allowance unless approved as extra. */
export async function approveRequest(db: Db, ledger: LedgerPort, input: { householdId: string; requestId: string; by: string; asExtra: boolean }, now: Date): Promise<{ grantId: string }> {
  const r = await requestIn(db, input.householdId, input.requestId);
  if (!r || r.status !== 'waiting') throw new EconomyError('not_found', "That isn't waiting any more.", 404);
  const target = { kind: r.targetKind, id: r.targetId };
  const { e, result, end } = await sessionCheck(db, ledger, { childId: r.childId, target, start: r.startsAt, minutes: r.minutes, asExtra: input.asExtra }, now);
  if (!result.ok) throw new EconomyError('cannot_approve', result.reason, 409);
  const won = await db
    .update(requests)
    .set({ status: 'approved', asExtra: input.asExtra, decidedBy: input.by, decidedAt: now })
    .where(and(eq(requests.id, r.id), eq(requests.status, 'waiting')))
    .returning({ id: requests.id });
  if (!won.length) throw new EconomyError('decided', 'Someone has already decided that one.', 409);
  const [g] = await db
    .insert(grants)
    .values({ householdId: e.householdId, childId: r.childId, targetKind: r.targetKind, targetId: r.targetId, startsAt: r.startsAt, endsAt: end, source: 'approved', status: 'scheduled', approvedBy: input.by, createdAt: now })
    .returning({ id: grants.id });
  if (!input.asExtra) {
    try {
      await ledger.spendTime({ ref: `grant:${g!.id}`, householdId: e.householdId, childId: r.childId, reason: 'A request, approved', at: now, by: input.by, minutes: r.minutes, data: { grantId: g!.id, requestId: r.id } });
    } catch (err) {
      await db.delete(grants).where(eq(grants.id, g!.id));
      await db.update(requests).set({ status: 'waiting', asExtra: false, decidedBy: null, decidedAt: null }).where(eq(requests.id, r.id));
      fromLedger(err);
    }
  }
  await db.update(requests).set({ grantId: g!.id }).where(eq(requests.id, r.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'request.approved', targetType: 'request', targetId: r.id, after: { grantId: g!.id, asExtra: input.asExtra } });
  return { grantId: g!.id };
}

export async function notYetRequest(db: Db, input: { householdId: string; requestId: string; by: string }, now: Date) {
  const r = await requestIn(db, input.householdId, input.requestId);
  if (!r) throw new EconomyError('not_found', "That isn't waiting any more.", 404);
  const won = await db
    .update(requests)
    .set({ status: 'not-yet', decidedBy: input.by, decidedAt: now })
    .where(and(eq(requests.id, r.id), eq(requests.status, 'waiting')))
    .returning({ id: requests.id });
  if (!won.length) throw new EconomyError('decided', 'Someone has already decided that one.', 409);
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'request.not_yet', targetType: 'request', targetId: r.id });
}

/** Undo of a request decision within a minute: the session goes and its time comes back. */
export async function undoRequest(db: Db, ledger: LedgerPort, input: { householdId: string; requestId: string; by: string }, now: Date) {
  const r = await requestIn(db, input.householdId, input.requestId);
  if (!r || r.status === 'waiting') throw new EconomyError('not_found', "There's nothing to undo.", 404);
  if (r.decidedBy !== input.by || !r.decidedAt || now.getTime() - r.decidedAt.getTime() > UNDO_MS) throw new EconomyError('too_late', 'That can no longer be undone.', 409);
  if (r.grantId) {
    const e = await loadEconomy(db, r.childId);
    await db.update(grants).set({ status: 'refunded' }).where(eq(grants.id, r.grantId));
    if (!r.asExtra) {
      await ledger
        .refund({ ref: `refund:grant:${r.grantId}`, householdId: e.householdId, childId: r.childId, reason: 'Approval undone', at: now, by: input.by, currency: 'TIME', amount: r.minutes, data: { grantId: r.grantId } })
        .catch(fromLedger);
    }
  }
  await db.update(requests).set({ status: 'waiting', asExtra: false, grantId: null, decidedBy: null, decidedAt: null }).where(eq(requests.id, r.id));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'request.undone', targetType: 'request', targetId: r.id });
}

// ---------------------------------------------------------------------------------------------
// Money, points and the plan

async function childOf(db: Db, householdId: string, childId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(childId)) throw new EconomyError('not_found', "Family time can't find that child.", 404);
  const e = await loadEconomy(db, childId).catch(() => undefined);
  if (!e || e.householdId !== householdId) throw new EconomyError('not_found', "Family time can't find that child.", 404);
  return e;
}

export async function recordPayout(db: Db, ledger: LedgerPort, input: { householdId: string; childId: string; by: string; pence: number }, now: Date) {
  const e = await childOf(db, input.householdId, input.childId);
  await ledger
    .recordPayout({ ref: `payout:${input.childId}:${now.getTime()}`, householdId: e.householdId, childId: e.childId, reason: 'Pocket money paid', at: now, by: input.by, pence: input.pence })
    .catch(fromLedger);
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'ledger.payout', targetType: 'person', targetId: input.childId, after: { pence: input.pence } });
}

/** Flex points into money or screen time, at the household's rates. Time stays inside the earned cap. */
export async function convertFlex(db: Db, ledger: LedgerPort, input: { householdId: string; childId: string; by: string; points: number; to: 'MONEY' | 'TIME' }, now: Date) {
  const e = await childOf(db, input.householdId, input.childId);
  let amount = input.points * (input.to === 'MONEY' ? e.rates.flexPence : e.rates.flexMinutes);
  if (input.to === 'TIME') {
    const week = weekStarting(now, e.weekReset, e.timeZone);
    const allowed = timeAwardable(amount, earnedThisWeek(await ledger.history(e.householdId, e.childId, { since: week.start })), e.allowanceMinutes);
    if (allowed < amount) throw new EconomyError('capped', allowed ? `Only ${minutes(allowed)} of this week's earned screen time is left.` : "This week's earned screen time is used up.", 409);
    amount = allowed;
  }
  await ledger
    .convert({
      ref: `convert:${input.childId}:${now.getTime()}`,
      householdId: e.householdId,
      childId: e.childId,
      reason: input.to === 'MONEY' ? 'Flex points to pocket money' : 'Flex points to screen time',
      at: now,
      by: input.by,
      points: input.points,
      to: input.to,
      amount,
    })
    .catch(fromLedger);
}

/** A refund as points: a parent's explicit choice, after a confirmation sheet. */
export async function refundPoints(db: Db, ledger: LedgerPort, input: { householdId: string; childId: string; by: string; points: number; reason: string }, now: Date) {
  const e = await childOf(db, input.householdId, input.childId);
  await ledger
    .refund({ ref: `refund:points:${input.childId}:${now.getTime()}`, householdId: e.householdId, childId: e.childId, reason: input.reason, at: now, by: input.by, currency: 'FLEX', amount: input.points })
    .catch(fromLedger);
}

/** Fix a mistake: reverse one entry exactly. */
export async function reverseEntry(db: Db, ledger: LedgerPort, input: { householdId: string; childId: string; by: string; entryRef: string }, now: Date) {
  const e = await childOf(db, input.householdId, input.childId);
  await ledger
    .reverse({ ref: `fix:${input.entryRef}`, householdId: e.householdId, childId: e.childId, reason: 'A mistake put right', at: now, by: input.by, entryRef: input.entryRef })
    .catch(fromLedger);
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'ledger.reversed', targetType: 'person', targetId: input.childId, after: { entryRef: input.entryRef } });
}

export async function setAllowance(db: Db, input: { householdId: string; childId: string; by: string; minutes: number }, now: Date) {
  await childOf(db, input.householdId, input.childId);
  await db
    .insert(allowances)
    .values({ childId: input.childId, weeklyMinutes: input.minutes, updatedAt: now })
    .onConflictDoUpdate({ target: allowances.childId, set: { weeklyMinutes: input.minutes, updatedAt: now } });
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'allowance.set', targetType: 'person', targetId: input.childId, after: { minutes: input.minutes } });
}

export async function setPlan(db: Db, input: { householdId: string; childId: string; by: string; plan: { stepMinutes: number; everyWeeks: number; floorMinutes: number; nextStepOn: string } }, now: Date) {
  await childOf(db, input.householdId, input.childId);
  const values = { ...input.plan, agreedStepOn: null, agreedBy: null, agreedAt: null, updatedAt: now };
  await db.insert(reductionPlans).values({ childId: input.childId, ...values }).onConflictDoUpdate({ target: reductionPlans.childId, set: values });
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'plan.set', targetType: 'person', targetId: input.childId, after: input.plan });
}

/** Ticked "agreed at the family review": the next step may now happen when it is due. */
export async function agreeStep(db: Db, input: { householdId: string; childId: string; by: string }, now: Date) {
  const e = await childOf(db, input.householdId, input.childId);
  if (!e.plan) throw new EconomyError('no_plan', 'There is no reduction plan yet.', 409);
  await db.update(reductionPlans).set({ agreedStepOn: e.plan.nextStepOn, agreedBy: input.by, agreedAt: now, updatedAt: now }).where(eq(reductionPlans.childId, input.childId));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'plan.agreed', targetType: 'person', targetId: input.childId, after: { step: e.plan.nextStepOn } });
}

export async function unagreeStep(db: Db, input: { householdId: string; childId: string; by: string }, now: Date) {
  await childOf(db, input.householdId, input.childId);
  await db.update(reductionPlans).set({ agreedStepOn: null, agreedBy: null, agreedAt: null, updatedAt: now }).where(eq(reductionPlans.childId, input.childId));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'plan.unagreed', targetType: 'person', targetId: input.childId });
}

export async function setGoal(db: Db, input: { householdId: string; childId: string; by: string; title: string; targetPence: number }, now: Date) {
  await childOf(db, input.householdId, input.childId);
  await db.update(goals).set({ active: false }).where(and(eq(goals.childId, input.childId), eq(goals.active, true)));
  await db.insert(goals).values({ childId: input.childId, title: input.title, targetPence: input.targetPence, createdAt: now });
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'goal.set', targetType: 'person', targetId: input.childId, after: { title: input.title, targetPence: input.targetPence } });
}

export async function setPilotPhase(db: Db, input: { householdId: string; by?: string; phase: string }) {
  await db.update(households).set({ pilotPhase: input.phase }).where(eq(households.id, input.householdId));
  await audit(db, { householdId: input.householdId, actor: input.by ? { personId: input.by } : { label: 'cli' }, action: 'pilot.phase', targetType: 'household', targetId: input.householdId, after: { phase: input.phase } });
}

/** Waiting completions and requests, for the tab's badge. */
export async function waitingCount(db: Db, householdId: string): Promise<number> {
  const kids = (await db.select({ id: people.id }).from(people).where(and(eq(people.householdId, householdId), eq(people.role, 'child'), eq(people.active, true)))).map((k) => k.id);
  if (!kids.length) return 0;
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(completions).where(and(inArray(completions.childId, kids), eq(completions.status, 'waiting')));
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(requests).where(and(inArray(requests.childId, kids), eq(requests.status, 'waiting')));
  return Number(c?.n ?? 0) + Number(r?.n ?? 0);
}

