// A child's economy settings in one shape, read by the api and the worker alike, so the two can
// never disagree about the allowance, the rates or the week.
import { features, parseWeekReset, type BonusRule, type Features, type ReductionPlan, type WeekReset } from '@family-time/domain';
import { and, eq } from 'drizzle-orm';
import { allowances, goals, households, people, reductionPlans, settings } from './schema.js';
import type { Db } from './types.js';

/** The household setting holding the rates. */
export const SETTING_ECONOMY = 'economy';

export interface Rates {
  bonus: BonusRule;
  /** What one flex point is worth. */
  flexPence: number;
  flexMinutes: number;
}

/** Brief VALUES and the mock: 10p per full 30 minutes, capped at £1 a week; a point is 1p or 1 minute. */
export const DEFAULT_RATES: Rates = { bonus: { pencePerBlock: 10, weeklyCapPence: 100 }, flexPence: 1, flexMinutes: 1 };
/** Brief VALUES: WEEKLY_ALLOWANCE_MIN = 420. */
export const DEFAULT_ALLOWANCE_MINUTES = 420;

export interface Economy {
  householdId: string;
  childId: string;
  childName: string;
  timeZone: string;
  weekReset: WeekReset;
  weekResetText: string;
  pilotPhase: string;
  features: Features;
  allowanceMinutes: number;
  plan: ReductionPlan | null;
  rates: Rates;
  /** `matchPercent`: the parents add this percent of the week's pocket money towards it. */
  goal: { id: string; title: string; targetPence: number; matchPercent: number } | null;
}

export async function loadRates(db: Db, householdId: string): Promise<Rates> {
  const row = (await db.select({ value: settings.value }).from(settings).where(and(eq(settings.householdId, householdId), eq(settings.key, SETTING_ECONOMY))))[0];
  const v = (row?.value ?? {}) as { bonus?: Record<string, unknown>; flexPence?: unknown; flexMinutes?: unknown };
  const whole = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : fallback);
  return {
    bonus: { pencePerBlock: whole(v.bonus?.pencePerBlock, DEFAULT_RATES.bonus.pencePerBlock), weeklyCapPence: whole(v.bonus?.weeklyCapPence, DEFAULT_RATES.bonus.weeklyCapPence) },
    flexPence: whole(v.flexPence, DEFAULT_RATES.flexPence),
    flexMinutes: whole(v.flexMinutes, DEFAULT_RATES.flexMinutes),
  };
}

export async function loadEconomy(db: Db, childId: string): Promise<Economy> {
  const child = (
    await db
      .select({ id: people.id, name: people.displayName, householdId: people.householdId, timeZone: households.timezone, weekResets: households.weekResets, pilotPhase: households.pilotPhase })
      .from(people)
      .innerJoin(households, eq(households.id, people.householdId))
      .where(and(eq(people.id, childId), eq(people.role, 'child'), eq(people.active, true)))
  )[0];
  if (!child) throw new Error(`No active child ${childId}`);
  const [allowance, plan, goal, rates] = await Promise.all([
    db.select().from(allowances).where(eq(allowances.childId, childId)),
    db.select().from(reductionPlans).where(eq(reductionPlans.childId, childId)),
    db.select().from(goals).where(and(eq(goals.childId, childId), eq(goals.active, true))),
    loadRates(db, child.householdId),
  ]);
  const p = plan[0];
  const g = goal[0];
  return {
    householdId: child.householdId,
    childId,
    childName: child.name,
    timeZone: child.timeZone,
    weekReset: parseWeekReset(child.weekResets),
    weekResetText: child.weekResets,
    pilotPhase: child.pilotPhase,
    features: features(child.pilotPhase),
    allowanceMinutes: allowance[0]?.weeklyMinutes ?? DEFAULT_ALLOWANCE_MINUTES,
    plan: p ? { stepMinutes: p.stepMinutes, everyWeeks: p.everyWeeks, floorMinutes: p.floorMinutes, nextStepOn: p.nextStepOn, agreedStepOn: p.agreedStepOn } : null,
    rates,
    goal: g ? { id: g.id, title: g.title, targetPence: g.targetPence, matchPercent: g.matchPercent } : null,
  };
}
