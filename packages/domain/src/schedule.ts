import { addDays, civilDate, parseClock, weekdayOf, zonedTime, type CivilDate } from './time.js';

export const BLOCK_TYPES = ['school', 'pause', 'wind-down', 'bed', 'free'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** A block of the day in local wall-clock time. `end` before `start` runs past midnight (bed 20:30 to 07:00). */
export interface ScheduleBlock {
  type: BlockType;
  start: string;
  end: string;
  /** What the family calls it, for example "Tea". */
  label?: string;
}

/** The household's day, for some weekdays. A child's own schedule replaces the household's on its days. */
export interface Schedule {
  id: string;
  /** For example "School night" or "Weekend". Shown in reasons: "Usual school-night rule". */
  name: string;
  childId: string | null;
  /** 0 Sunday to 6 Saturday. */
  weekdays: number[];
  blocks: ScheduleBlock[];
}

export interface BlockInterval {
  type: BlockType;
  label?: string;
  scheduleName: string;
  start: Date;
  end: Date;
}

/** The schedule that governs a child on a date: their own if one covers that weekday, else the household's. */
export function scheduleFor(schedules: Schedule[], childId: string, date: CivilDate): Schedule | undefined {
  const weekday = weekdayOf(date);
  const covers = (s: Schedule) => s.weekdays.includes(weekday);
  return schedules.find((s) => s.childId === childId && covers(s)) ?? schedules.find((s) => s.childId === null && covers(s));
}

/** The concrete blocks that start on a date, in UTC. */
export function blocksOn(schedules: Schedule[], childId: string, date: CivilDate, timeZone: string): BlockInterval[] {
  const schedule = scheduleFor(schedules, childId, date);
  if (!schedule) return [];
  return schedule.blocks.map((b) => {
    const startMin = parseClock(b.start);
    const endMin = parseClock(b.end);
    const endDate = endMin <= startMin ? addDays(date, 1) : date;
    return {
      type: b.type,
      ...(b.label ? { label: b.label } : {}),
      scheduleName: schedule.name,
      start: zonedTime(date.year, date.month, date.day, startMin, timeZone),
      end: zonedTime(endDate.year, endDate.month, endDate.day, endMin, timeZone),
    };
  });
}

/** Every block that touches the days from `daysBefore` before `at` to `daysAfter` after. */
export function blocksAround(schedules: Schedule[], childId: string, at: Date, timeZone: string, daysBefore = 1, daysAfter = 2): BlockInterval[] {
  const today = civilDate(at, timeZone);
  const out: BlockInterval[] = [];
  for (let d = -daysBefore; d <= daysAfter; d++) out.push(...blocksOn(schedules, childId, addDays(today, d), timeZone));
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function activeBlocks(schedules: Schedule[], childId: string, at: Date, timeZone: string): BlockInterval[] {
  const t = at.getTime();
  return blocksAround(schedules, childId, at, timeZone, 1, 0).filter((b) => b.start.getTime() <= t && t < b.end.getTime());
}

/** The start of the next bed block at or after `at`, if there is one in the next two days. */
export function nextBedtime(schedules: Schedule[], childId: string, at: Date, timeZone: string): Date | undefined {
  const t = at.getTime();
  return blocksAround(schedules, childId, at, timeZone, 0, 2).find((b) => b.type === 'bed' && b.start.getTime() >= t)?.start;
}

/** The schedule name that applies to a child now, for "Usual school-night rule". */
export function ruleNameAt(schedules: Schedule[], childId: string, at: Date, timeZone: string): string | undefined {
  return scheduleFor(schedules, childId, civilDate(at, timeZone))?.name;
}
