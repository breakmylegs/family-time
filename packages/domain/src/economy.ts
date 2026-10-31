// The economy's rules, pure like the control engine: the week, the allowance and its reduction,
// earned screen time and its cap, the unused-time bonus, planning a session, and what a parent's
// Block or a counted Allow does to the child's time. The ledger records; these decide.
import { blockName } from './day.js';
import { blocksOn, type Schedule } from './schedule.js';
import { addDays, civilDate, clockLabel, weekdayOf, zonedTime, type CivilDate } from './time.js';

/** The unit of screen time everywhere: the kiosk plans in it, the bonus pays per it. */
export const BLOCK_MINUTES = 30;
/** Screen time earned from jobs is capped at this share of the weekly allowance (brief Part 6). */
export const EARNED_TIME_SHARE = 0.15;

// ---------------------------------------------------------------------------------------------
// The week

export interface WeekReset {
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
  minuteOfDay: number;
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** `SUN 18:00`, as households.week_resets holds it. */
export function parseWeekReset(value: string): WeekReset {
  const m = /^(SUN|MON|TUE|WED|THU|FRI|SAT) ([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim().toUpperCase());
  if (!m) throw new Error(`"${value}" is not a week reset like SUN 18:00`);
  return { weekday: DAYS.indexOf(m[1]!), minuteOfDay: Number(m[2]) * 60 + Number(m[3]) };
}

export const isoDate = (d: CivilDate) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
export const fromIsoDate = (s: string): CivilDate => {
  const [year, month, day] = s.split('-').map(Number) as [number, number, number];
  return { year, month, day };
};
export const addIsoDays = (s: string, days: number) => isoDate(addDays(fromIsoDate(s), days));

/** The week `at` falls in: from the last reset at or before it, to the next. Local time, so 18:00 stays 18:00 across a clock change. */
export function weekStarting(at: Date, reset: WeekReset, timeZone: string): { start: Date; date: string; next: Date } {
  const today = civilDate(at, timeZone);
  let date = addDays(today, -((weekdayOf(today) - reset.weekday + 7) % 7));
  let start = zonedTime(date.year, date.month, date.day, reset.minuteOfDay, timeZone);
  if (start.getTime() > at.getTime()) {
    date = addDays(date, -7);
    start = zonedTime(date.year, date.month, date.day, reset.minuteOfDay, timeZone);
  }
  const nextDate = addDays(date, 7);
  return { start, date: isoDate(date), next: zonedTime(nextDate.year, nextDate.month, nextDate.day, reset.minuteOfDay, timeZone) };
}

// ---------------------------------------------------------------------------------------------
// The allowance and the reduction plan

export interface ReductionPlan {
  stepMinutes: number;
  everyWeeks: number;
  floorMinutes: number;
  /** The week (its start date) the next step is due. */
  nextStepOn: string;
  /** The step a parent ticked "agreed at the family review": the date it was due. */
  agreedStepOn: string | null;
}

/**
 * The allowance for the week starting `weekDate`. A step happens only when it is due and was ticked
 * agreed for that date; a step agreed late applies at the next week. Never below the floor, never up.
 */
export function nextAllowance(current: number, plan: ReductionPlan | null, weekDate: string): { minutes: number; stepped: boolean; plan: ReductionPlan | null } {
  if (!plan || weekDate < plan.nextStepOn || plan.agreedStepOn !== plan.nextStepOn || current <= plan.floorMinutes) {
    return { minutes: current, stepped: false, plan };
  }
  const minutes = Math.max(plan.floorMinutes, current - Math.max(0, plan.stepMinutes));
  if (minutes >= current) return { minutes: current, stepped: false, plan };
  return { minutes, stepped: true, plan: { ...plan, nextStepOn: addIsoDays(weekDate, plan.everyWeeks * 7), agreedStepOn: null } };
}

// ---------------------------------------------------------------------------------------------
// Earned screen time and the bonus

export function earnedTimeCap(weeklyAllowance: number): number {
  return Math.max(0, Math.floor(weeklyAllowance * EARNED_TIME_SHARE));
}

/** How much of an ask can be paid as screen time, given what was earned this week already. */
export function timeAwardable(ask: number, earnedThisWeek: number, weeklyAllowance: number): number {
  return Math.max(0, Math.min(ask, earnedTimeCap(weeklyAllowance) - earnedThisWeek));
}

export interface BonusRule {
  pencePerBlock: number;
  weeklyCapPence: number;
}

/** Pocket money for the screen time left at the week's end: per full 30 minutes, up to the cap. */
export function unusedBonus(minutesLeft: number, rule: BonusRule): number {
  const blocks = Math.floor(Math.max(0, minutesLeft) / BLOCK_MINUTES);
  return Math.max(0, Math.min(rule.weeklyCapPence, blocks * Math.max(0, rule.pencePerBlock)));
}

// ---------------------------------------------------------------------------------------------
// Planning a session

export interface PlanCheck {
  schedules: Schedule[];
  childId: string;
  timeZone: string;
  now: Date;
  start: Date;
  minutes: number;
  /** TIME the child has now. */
  balanceMinutes: number;
  /** Minutes of this app already planned today, for the daily cap. */
  plannedToday: number;
  dailyCapMinutes?: number | null;
  sessionCapMinutes?: number | null;
  /** True when this app is already planned for some of that time. */
  overlapsOwn: boolean;
}

/** Why a plan is refused. The api decides on the code, never on the words, which are the child's. */
export type PlanRefusal = 'blocks' | 'session' | 'past' | 'today' | 'busy' | 'outside' | 'window' | 'overlap' | 'daily' | 'balance';
export type PlanResult = { ok: true } | { ok: false; code: PlanRefusal; reason: string };

/** Whether the child can plan this, and if not, why, in words for the kiosk. */
export function checkPlan(p: PlanCheck): PlanResult {
  const no = (code: PlanRefusal, reason: string): PlanResult => ({ ok: false, code, reason });
  if (p.minutes <= 0 || p.minutes % BLOCK_MINUTES !== 0) return no('blocks', 'Plan in blocks of 30 minutes.');
  if (p.sessionCapMinutes && p.minutes > p.sessionCapMinutes) return no('session', `You can plan up to ${p.sessionCapMinutes} minutes in one go.`);
  // Starting "now" is fine; a minute's grace for the time it took to tap.
  if (p.start.getTime() < p.now.getTime() - 60_000) return no('past', 'That time has already passed. Pick a later one.');
  const today = civilDate(p.now, p.timeZone);
  const day = civilDate(p.start, p.timeZone);
  if (day.year !== today.year || day.month !== today.month || day.day !== today.day) return no('today', 'Pick a time today.');

  const end = p.start.getTime() + p.minutes * 60_000;
  const blocks = blocksOn(p.schedules, p.childId, today, p.timeZone)
    .concat(blocksOn(p.schedules, p.childId, addDays(today, -1), p.timeZone))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const s = p.start.getTime();
  const holding = blocks.find((b) => b.start.getTime() <= s && s < b.end.getTime() && b.type !== 'free');
  if (holding) return no('busy', holding.type === 'bed' ? "It's bedtime then." : `${blockName(holding)} is on then. Pick another time.`);
  const free = blocks.find((b) => b.type === 'free' && b.start.getTime() <= s && s < b.end.getTime());
  if (!free) return no('outside', 'Pick a time in free time.');
  // Free time may run on into another free block; anything else ends the window.
  let windowEnd = free.end.getTime();
  for (;;) {
    const next = blocks.find((b) => b.type === 'free' && b.start.getTime() === windowEnd);
    if (!next) break;
    windowEnd = next.end.getTime();
  }
  if (end > windowEnd) {
    const after = blocks.find((b) => b.start.getTime() === windowEnd);
    const at = clockLabel(new Date(windowEnd), p.now, p.timeZone);
    return no('window', after ? `${blockName(after)} starts at ${at}.` : `Free time ends at ${at}.`);
  }

  if (p.overlapsOwn) return no('overlap', "You've already planned that then.");
  if (p.dailyCapMinutes && p.plannedToday + p.minutes > p.dailyCapMinutes) return no('daily', "That's today's limit for this one.");
  // Never a countdown: say what can be planned, or who to ask.
  if (p.minutes > p.balanceMinutes) {
    return no('balance', p.balanceMinutes < BLOCK_MINUTES ? "That's this week's time all planned. You can ask a grown-up." : `You've got ${p.balanceMinutes} minutes to plan this week. Try a shorter go.`);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// A parent stepping in

export interface Span {
  start: Date;
  /** Null: until resumed, so to the end of whatever it is measured against. */
  end: Date | null;
}

/** Minutes of a planned session a parent's Block or Pause took back. Overlaps are counted once. */
export function minutesLost(session: { start: Date; end: Date }, spans: Span[]): number {
  const s0 = session.start.getTime();
  const s1 = session.end.getTime();
  const cut = spans
    .map((x) => [Math.max(s0, x.start.getTime()), Math.min(s1, x.end ? x.end.getTime() : s1)] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reach = s0;
  for (const [a, b] of cut) {
    const from = Math.max(a, reach);
    if (b > from) total += b - from;
    reach = Math.max(reach, b);
  }
  return Math.min(Math.ceil(total / 60_000), Math.round((s1 - s0) / 60_000));
}

/** An Allow that counts in weekly time: the minutes it ran, rounded up, never more than is left. */
export function allowCharge(start: Date, end: Date, balanceMinutes: number): number {
  const ran = Math.ceil(Math.max(0, end.getTime() - start.getTime()) / 60_000);
  return Math.max(0, Math.min(ran, balanceMinutes));
}

// ---------------------------------------------------------------------------------------------
// The pilot

export const PILOT_PHASES = ['baseline', 'reframe', 'reward-less', 'transitions', 'taper'] as const;
export type PilotPhase = (typeof PILOT_PHASES)[number];

export interface Features {
  /** The allowance, jobs in money and flex, approvals and planning. */
  economy: boolean;
  /** The unused-time bonus at the week's end. */
  bonus: boolean;
  /** The child's savings goal. */
  goal: boolean;
  /** Reduction steps can apply. */
  taper: boolean;
}

/** What each pilot phase switches on (brief Part 14). Unknown phases are treated as baseline. */
export function features(phase: string): Features {
  const i = PILOT_PHASES.indexOf(phase as PilotPhase);
  return { economy: i >= 1, bonus: i >= 2, goal: i >= 2, taper: i >= 4 };
}
