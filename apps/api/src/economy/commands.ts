// The economy's actions, shared by the api routes, the command line and (Phase 6) the kiosk. They
// decide with the domain's rules, record on the ledger, and keep the tables beside it in step.
// The child's side (plan, log a job, ask) is here too; only its screens wait for the kiosk.
//
// Order matters where a decision and the ledger meet: the decision is claimed first (a
// conditional update only one caller wins), then the ledger is written, then the decision is
// marked complete. Undo only works on a complete decision, so it can never slip in between.
import { randomUUID } from 'node:crypto';
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
  type Economy,
} from '@family-time/db';
import { addIsoDays, blocksOn, checkPlan, civilDate, clockLabel, earnedTimeCap, weekStarting, zonedTime, type Features, type PlanRefusal } from '@family-time/domain';
import { LedgerError, reversible, type EarnedCap, type LedgerEntry, type LedgerPort } from '@family-time/ledger';
import type { ApprovalItem, LedgerLine, Recurrence, Task, TaskInput, WeekSummary } from '@family-time/schemas';
import { and, asc, eq, gt, gte, inArray, isNotNull, or, sql } from 'drizzle-orm';
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
function fromLedger(err: unknown, childName = 'Your child'): never {
  if (err instanceof LedgerError) {
    const words: Partial<Record<LedgerError['code'], string>> = {
      insufficient: `${err.message} If it has already been paid or used, leave it as it is.`,
      capped: `${childName} has had all the screen time jobs and points can add this week. Choose pocket money or flex points instead.`,
      not_found: "That line isn't in the history any more. Reload the page.",
    };
    throw new EconomyError(err.code, words[err.code] ?? err.message, err.code === 'not_found' ? 404 : 409);
  }
  throw err;
}

/** The earned-time cap for this week: 15% of the allowance this week was actually given. */
async function capFor(ledger: LedgerPort, e: Economy, now: Date): Promise<EarnedCap & { allowance: number }> {
  const week = weekStarting(now, e.weekReset, e.timeZone);
  const given = (await ledger.history(e.householdId, e.childId, { since: week.start, limit: 1000 })).find((x) => x.kind === 'allowance');
  const allowance = given?.time ?? e.allowanceMinutes;
  return { capMinutes: earnedTimeCap(allowance), since: week.start, allowance };
}

/** The next four days the week resets on, for the plan sheet. */
function resetDays(e: Economy, now: Date): { on: string; label: string }[] {
  const first = weekStarting(now, e.weekReset, e.timeZone).date;
  return [1, 2, 3, 4].map((n) => {
    const on = addIsoDays(first, 7 * n);
    return { on, label: dateLabel(on) };
  });
}

// ---------------------------------------------------------------------------------------------
// The week at a glance

export async function weekSummary(db: Db, ledger: LedgerPort, childId: string, now: Date): Promise<WeekSummary> {
  const e = await loadEconomy(db, childId);
  const week = weekStarting(now, e.weekReset, e.timeZone);
  const [balance, thisWeek, history, cap] = await Promise.all([
    ledger.balances(e.householdId, childId),
    ledger.history(e.householdId, childId, { since: week.start, limit: 1000 }),
    ledger.history(e.householdId, childId, { limit: 50 }),
    capFor(ledger, e, now),
  ]);
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
  const days = resetDays(e, now);
  return {
    childId,
    features: e.features,
    allowanceMinutes: cap.allowance,
    leftMinutes: balance.time,
    plannedMinutes: planned,
    usedMinutes: Math.max(0, spent - refunded - planned),
    earnedMinutes: await ledger.earnedTime(e.householdId, childId, week.start),
    earnedCapMinutes: cap.capMinutes,
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
          active: e.features.taper,
          stepMinutes: e.plan.stepMinutes,
          everyWeeks: e.plan.everyWeeks,
          floorMinutes: e.plan.floorMinutes,
          resetDays: days,
        }
      : null,
    resetDays: days,
    goal: e.goal ? { title: e.goal.title, targetPence: e.goal.targetPence, savedPence: Math.max(0, Math.min(balance.money, e.goal.targetPence)) } : null,
    rates: { pencePerBlock: e.rates.bonus.pencePerBlock, weeklyCapPence: e.rates.bonus.weeklyCapPence, flexPence: e.rates.flexPence, flexMinutes: e.rates.flexMinutes },
  };
}

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
    reversible: reversible(x) && !reversed.has(x.ref),
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
  if (!c.length) throw new EconomyError('not_found', "Family time can't find that child. Reload to see who's in your family now.", 404);
}

const NO_JOB = "That job isn't on the list any more. Reload to see the list now.";

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
  if (!row) throw new EconomyError('not_found', NO_JOB, 404);
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'task.updated', targetType: 'task', targetId: row.id, after: input.task });
  return toTask(row);
}

/** Jobs are archived, never deleted: completions point at them. So a removal can be undone. */
export async function archiveTask(db: Db, input: { householdId: string; by: string; taskId: string; active?: boolean }): Promise<void> {
  const active = input.active ?? false;
  const rows = await db.update(tasks).set({ active }).where(and(eq(tasks.id, input.taskId), eq(tasks.householdId, input.householdId))).returning({ id: tasks.id });
  if (!rows.length) throw new EconomyError('not_found', NO_JOB, 404);
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: active ? 'task.restored' : 'task.archived', targetType: 'task', targetId: input.taskId });
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
    throw new EconomyError('not_today', "That one's for another day.", 409);
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
  if (earlier.length) throw new EconomyError('done', rec.kind === 'once' ? "You've already done that one." : "That one's done for today.", 409);
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
  return { daily: own?.dailyCapMinutes ?? null, session: own?.sessionCapMinutes ?? null };
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

/** Writes a session: its TIME first (when it costs any), then the grant AdGuard will honour. */
async function writeSession(
  db: Db,
  ledger: LedgerPort,
  input: { e: Economy; target: { kind: 'service' | 'group'; id: string }; start: Date; end: Date; minutes: number; source: 'planned' | 'approved'; by?: string; reason: string; spend: boolean; requestId?: string },
  now: Date,
): Promise<string> {
  const grantId = randomUUID();
  const base = { householdId: input.e.householdId, childId: input.e.childId, at: now, ...(input.by ? { by: input.by } : {}) };
  if (input.spend) {
    await ledger.spendTime({ ...base, ref: `grant:${grantId}`, reason: input.reason, minutes: input.minutes, data: { grantId, ...(input.requestId ? { requestId: input.requestId } : {}) } }).catch((err) => fromLedger(err, input.e.childName));
  }
  try {
    await db.insert(grants).values({
      id: grantId,
      householdId: input.e.householdId,
      childId: input.e.childId,
      targetKind: input.target.kind,
      targetId: input.target.id,
      startsAt: input.start,
      endsAt: input.end,
      source: input.source,
      status: 'scheduled',
      ...(input.by && input.source === 'approved' ? { approvedBy: input.by } : {}),
      createdAt: now,
    });
  } catch (err) {
    // The time was spent but the session could not be saved: give the time straight back.
    if (input.spend) await ledger.refund({ ...base, ref: `refund:grant:${grantId}`, reason: 'A session that could not be saved', currency: 'TIME', amount: input.minutes });
    throw err;
  }
  return grantId;
}

/** Plan my time: the session's TIME is spent at once, and the grant follows. */
export async function planSession(db: Db, ledger: LedgerPort, input: { childId: string; target: { kind: 'service' | 'group'; id: string }; start: Date; minutes: number }, now: Date): Promise<string> {
  const { e, result, end } = await sessionCheck(db, ledger, input, now);
  needEconomy(e.features);
  const name = await targetName(db, e.householdId, input.target);
  if (!result.ok) throw new EconomyError('cannot_plan', result.reason, 409);
  const window = `${clockLabel(input.start, now, e.timeZone)} to ${clockLabel(end, now, e.timeZone)}`;
  return writeSession(db, ledger, { e, target: input.target, start: input.start, end, minutes: input.minutes, source: 'planned', reason: `Planned: ${name}, ${window}`, spend: true }, now);
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

/** Why a request can't be approved, in a parent's words (the domain's are the child's). */
function parentReason(code: PlanRefusal, childReason: string, child: string, target: string): string {
  switch (code) {
    case 'overlap':
      return `${child} already has ${target} planned then.`;
    case 'daily':
      return `That's over today's limit for ${target}.`;
    case 'past':
      return 'That time has already passed.';
    case 'today':
      return "That isn't today.";
    case 'outside':
      return "That's outside free time.";
    case 'session':
      return `That's longer than one go of ${target} can be.`;
    default:
      // "Wind-down starts at 19:30." and "It's bedtime then." read as well for a parent.
      return childReason.replace(/ Pick another time\.$/, '');
  }
}

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
        const cap = await capFor(ledger, e, now);
        const left = Math.max(0, cap.capMinutes - (await ledger.earnedTime(e.householdId, c.childId, cap.since)));
        amount = Math.min(t.amount, left);
        if (amount < t.amount) {
          capNote = amount
            ? `Jobs can add ${minutes(amount)} more screen time this week, so approving adds ${minutes(amount)}, not ${minutes(t.amount)}.`
            : `${e.childName} has had all the screen time jobs can add this week, so approving adds no time. Your note still goes to ${e.childName}.`;
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
    const extraOnly = !result.ok && result.code === 'balance';
    const blockedReason = result.ok || extraOnly ? null : parentReason(result.code, result.reason, k.name, name);
    const rules = await loadRules(db, r.childId, now);
    const wind = blocksOn(rules.schedules, r.childId, civilDate(now, e.timeZone), e.timeZone).find((b) => b.type === 'wind-down' && b.start.getTime() >= end.getTime());
    const windNote = wind ? `, and wind-down starts at ${clockLabel(wind.start, now, e.timeZone)}` : '';
    const left = Math.max(0, balance.time);
    const detail = extraOnly
      ? left
        ? `${p.They} ${p.has} ${minutes(left)} left this week, so a yes would be extra time on top${windNote}.`
        : `${p.They} ${p.has} planned all of this week's time, so a yes would be extra time on top${windNote}.`
      : `Uses ${r.minutes} minutes of ${p.their} own time. ${p.They} ${p.has} ${minutes(left)} left this week${windNote}.`;
    out.push({
      kind: 'request',
      id: r.id,
      childId: r.childId,
      childName: k.name,
      title: r.detail ?? `${name} at ${clockLabel(r.startsAt, now, e.timeZone)}`,
      target: name,
      when: when(r.askedAt, now, e.timeZone),
      minutes: r.minutes,
      window: `${clockLabel(r.startsAt, now, e.timeZone)} to ${clockLabel(end, now, e.timeZone)}`,
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

const GONE = "That isn't waiting any more. Someone may have answered it already.";

/** Approve a job (or send praise): pay what the job pays, within the earned-time cap, with a note. */
export async function approveCompletion(db: Db, ledger: LedgerPort, input: { householdId: string; completionId: string; by: string; note: string | null }, now: Date) {
  const found = await completionIn(db, input.householdId, input.completionId);
  if (!found) throw new EconomyError('not_found', GONE, 404);
  const { c, t } = found;
  // 1. Claim the decision: only one wins, even if two parents tap at once.
  const won = await db
    .update(completions)
    .set({ status: 'approved', note: input.note, paid: null, decidedBy: input.by, decidedAt: now })
    .where(and(eq(completions.id, c.id), eq(completions.status, 'waiting')))
    .returning({ id: completions.id });
  if (!won.length) throw new EconomyError('decided', 'Someone has already decided that one.', 409);
  const e = await loadEconomy(db, c.childId);
  // 2. Pay. One reference per decision, so a retry pays once.
  let paid: { currency: 'MONEY' | 'FLEX' | 'TIME'; amount: number; ref: string } | { none: true } = { none: true };
  if (t.rewardType !== 'praise') {
    const currency = t.rewardType === 'money' ? 'MONEY' : t.rewardType === 'flex' ? 'FLEX' : 'TIME';
    const ref = `completion:${c.id}:${now.getTime()}`;
    try {
      const entry = await ledger.award({
        ref,
        householdId: e.householdId,
        childId: c.childId,
        reason: t.title,
        at: now,
        by: input.by,
        currency,
        amount: t.amount,
        data: { completionId: c.id },
        ...(currency === 'TIME' ? { cap: await capFor(ledger, e, now) } : {}),
      });
      paid = { currency, amount: entry.time || entry.money || entry.flex, ref };
    } catch (err) {
      // The cap used up: approved with your note, and no time.
      if (!(err instanceof LedgerError && err.code === 'capped')) {
        await db.update(completions).set({ status: 'waiting', note: null, decidedBy: null, decidedAt: null }).where(eq(completions.id, c.id));
        fromLedger(err, e.childName);
      }
    }
  }
  // 3. Complete: from here Undo can take it back.
  await db.update(completions).set({ paid }).where(and(eq(completions.id, c.id), eq(completions.decidedAt, now)));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'completion.approved', targetType: 'completion', targetId: c.id, after: { paid, note: input.note } });
  return { paid: 'none' in paid ? null : paid };
}

export async function notYetCompletion(db: Db, input: { householdId: string; completionId: string; by: string; note: string | null }, now: Date) {
  const found = await completionIn(db, input.householdId, input.completionId);
  if (!found) throw new EconomyError('not_found', GONE, 404);
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
  if (c.decidedBy !== input.by || !c.decidedAt || now.getTime() - c.decidedAt.getTime() > UNDO_MS) {
    throw new EconomyError('too_late', 'That can no longer be undone. To change it, use Fix a mistake on the Family screen.', 409);
  }
  // An approval still being saved is not complete yet.
  if (c.status === 'approved' && !c.paid) throw new EconomyError('saving', 'Still saving. Try Undo again in a moment.', 409);
  const back = await db
    .update(completions)
    .set({ status: 'waiting', note: null, paid: null, decidedBy: null, decidedAt: null })
    .where(and(eq(completions.id, c.id), eq(completions.decidedAt, c.decidedAt), or(eq(completions.status, 'not-yet'), isNotNull(completions.paid))))
    .returning({ id: completions.id });
  if (!back.length) throw new EconomyError('decided', 'That has changed since. Reload to see it now.', 409);
  const paid = c.paid as { ref?: string } | null;
  if (paid?.ref) {
    const e = await loadEconomy(db, c.childId);
    await ledger.reverse({ ref: `undo:${paid.ref}`, householdId: e.householdId, childId: c.childId, reason: `Approval undone: ${found.t.title}`, at: now, by: input.by, entryRef: paid.ref }).catch((err) => fromLedger(err, e.childName));
  }
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

/** Yes to a request: claimed, then the time spent (unless as extra), then the session, then complete. */
export async function approveRequest(db: Db, ledger: LedgerPort, input: { householdId: string; requestId: string; by: string; asExtra: boolean }, now: Date): Promise<{ grantId: string }> {
  const r = await requestIn(db, input.householdId, input.requestId);
  if (!r || r.status !== 'waiting') throw new EconomyError('not_found', GONE, 404);
  const target = { kind: r.targetKind, id: r.targetId };
  const { e, result, end } = await sessionCheck(db, ledger, { childId: r.childId, target, start: r.startsAt, minutes: r.minutes, asExtra: input.asExtra }, now);
  if (!result.ok) throw new EconomyError('cannot_approve', parentReason(result.code, result.reason, e.childName, await targetName(db, input.householdId, target)), 409);
  const won = await db
    .update(requests)
    .set({ status: 'approved', asExtra: input.asExtra, grantId: null, decidedBy: input.by, decidedAt: now })
    .where(and(eq(requests.id, r.id), eq(requests.status, 'waiting')))
    .returning({ id: requests.id });
  if (!won.length) throw new EconomyError('decided', 'Someone has already decided that one.', 409);
  const name = await targetName(db, input.householdId, target);
  let grantId: string;
  try {
    grantId = await writeSession(
      db,
      ledger,
      {
        e,
        target,
        start: r.startsAt,
        end,
        minutes: r.minutes,
        source: 'approved',
        by: input.by,
        reason: `Asked for: ${name}, ${clockLabel(r.startsAt, now, e.timeZone)} to ${clockLabel(end, now, e.timeZone)}`,
        spend: !input.asExtra,
        requestId: r.id,
      },
      now,
    );
  } catch (err) {
    await db.update(requests).set({ status: 'waiting', asExtra: false, decidedBy: null, decidedAt: null }).where(eq(requests.id, r.id));
    throw err;
  }
  await db.update(requests).set({ grantId }).where(and(eq(requests.id, r.id), eq(requests.decidedAt, now)));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'request.approved', targetType: 'request', targetId: r.id, after: { grantId, asExtra: input.asExtra } });
  return { grantId };
}

export async function notYetRequest(db: Db, input: { householdId: string; requestId: string; by: string }, now: Date) {
  const r = await requestIn(db, input.householdId, input.requestId);
  if (!r) throw new EconomyError('not_found', GONE, 404);
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
  if (r.decidedBy !== input.by || !r.decidedAt || now.getTime() - r.decidedAt.getTime() > UNDO_MS) {
    throw new EconomyError('too_late', 'That can no longer be undone. To stop the session, use Block on Control.', 409);
  }
  if (r.status === 'approved' && !r.grantId) throw new EconomyError('saving', 'Still saving. Try Undo again in a moment.', 409);
  const back = await db
    .update(requests)
    .set({ status: 'waiting', asExtra: false, grantId: null, decidedBy: null, decidedAt: null })
    .where(and(eq(requests.id, r.id), eq(requests.decidedAt, r.decidedAt), or(eq(requests.status, 'not-yet'), isNotNull(requests.grantId))))
    .returning({ id: requests.id });
  if (!back.length) throw new EconomyError('decided', 'That has changed since. Reload to see it now.', 409);
  if (r.grantId) {
    const e = await loadEconomy(db, r.childId);
    await db.update(grants).set({ status: 'refunded' }).where(eq(grants.id, r.grantId));
    if (!r.asExtra) {
      await ledger
        .refund({ ref: `refund:grant:${r.grantId}`, householdId: e.householdId, childId: r.childId, reason: 'Approval undone', at: now, by: input.by, currency: 'TIME', amount: r.minutes, data: { grantId: r.grantId } })
        .catch((err) => fromLedger(err, e.childName));
    }
  }
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'request.undone', targetType: 'request', targetId: r.id });
}

// ---------------------------------------------------------------------------------------------
// Money, points and the plan

async function childOf(db: Db, householdId: string, childId: string, opts: { writesLedger?: boolean } = {}) {
  const missing = new EconomyError('not_found', "Family time can't find that child. Reload to see who's in your family now.", 404);
  if (!/^[0-9a-f-]{36}$/i.test(childId)) throw missing;
  const e = await loadEconomy(db, childId).catch(() => undefined);
  if (!e || e.householdId !== householdId) throw missing;
  // No points move during the pilot's baseline weeks, which only measure.
  if (opts.writesLedger) needEconomy(e.features);
  return e;
}

export async function recordPayout(db: Db, ledger: LedgerPort, input: { householdId: string; childId: string; by: string; pence: number; key: string }, now: Date) {
  const e = await childOf(db, input.householdId, input.childId, { writesLedger: true });
  await ledger
    .recordPayout({ ref: `payout:${input.key}`, householdId: e.householdId, childId: e.childId, reason: 'Pocket money paid', at: now, by: input.by, pence: input.pence })
    .catch((err) => fromLedger(err, e.childName));
  await audit(db, { householdId: input.householdId, actor: { personId: input.by }, action: 'ledger.payout', targetType: 'person', targetId: input.childId, after: { pence: input.pence } });
}

/** Flex points into money or screen time, at the household's rates. Time stays inside the earned cap. */
export async function convertFlex(db: Db, ledger: LedgerPort, input: { householdId: string; childId: string; by: string; points: number; to: 'MONEY' | 'TIME'; key: string }, now: Date) {
  const e = await childOf(db, input.householdId, input.childId, { writesLedger: true });
  const amount = input.points * (input.to === 'MONEY' ? e.rates.flexPence : e.rates.flexMinutes);
  try {
    await ledger.convert({
      ref: `convert:${input.key}`,
      householdId: e.householdId,
      childId: e.childId,
      reason: input.to === 'MONEY' ? 'Flex points to pocket money' : 'Flex points to screen time',
      at: now,
      by: input.by,
      points: input.points,
      to: input.to,
      amount,
      ...(input.to === 'TIME' ? { cap: await capFor(ledger, e, now) } : {}),
    });
  } catch (err) {
    if (err instanceof LedgerError && err.code === 'capped') {
      const cap = await capFor(ledger, e, now);
      const left = Math.max(0, cap.capMinutes - (await ledger.earnedTime(e.householdId, e.childId, cap.since)));
      throw new EconomyError(
        'capped',
        left ? `Points can add only ${minutes(left)} more screen time this week. Convert fewer points, or choose pocket money.` : `${e.childName} has had all the screen time points and jobs can add this week. Choose pocket money instead.`,
        409,
      );
    }
    fromLedger(err, e.childName);
  }
}

/** Points given back: a parent's explicit choice, after a confirmation sheet. Reversible as a mistake. */
export async function refundPoints(db: Db, ledger: LedgerPort, input: { householdId: string; childId: string; by: string; points: number; reason: string; key: string }, now: Date) {
  const e = await childOf(db, input.householdId, input.childId, { writesLedger: true });
  await ledger
    .refund({ ref: `refund:points:${input.key}`, householdId: e.householdId, childId: e.childId, reason: input.reason, at: now, by: input.by, currency: 'FLEX', amount: input.points, chosen: true })
    .catch((err) => fromLedger(err, e.childName));
}

/** Fix a mistake: reverse one entry exactly, once. */
export async function reverseEntry(db: Db, ledger: LedgerPort, input: { householdId: string; childId: string; by: string; entryRef: string }, now: Date) {
  const e = await childOf(db, input.householdId, input.childId, { writesLedger: true });
  const original = (await ledger.history(e.householdId, e.childId, { limit: 1000 })).find((x) => x.ref === input.entryRef);
  await ledger
    .reverse({ ref: `fix:${input.entryRef}`, householdId: e.householdId, childId: e.childId, reason: `Put right: ${original?.reason ?? 'a mistake'}`, at: now, by: input.by, entryRef: input.entryRef })
    .catch((err) => fromLedger(err, e.childName));
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
  if (!e.plan) throw new EconomyError('no_plan', 'Set up a reduction plan first.', 409);
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
