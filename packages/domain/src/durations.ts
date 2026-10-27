import { nextBedtime, type Schedule } from './schedule.js';
import { addDays, civilDate, zonedTime } from './time.js';

/** The four choices on the Allow, Block and Pause sheets. */
export const DURATIONS = ['30m', '1h', 'until-bedtime', 'until-tomorrow'] as const;
export type DurationChoice = (typeof DURATIONS)[number];

/** Tomorrow morning means 07:00, the end of a usual bedtime. */
const MORNING_MINUTES = 7 * 60;

export interface OverrideWindow {
  end: Date;
  /** Only "until tomorrow" runs through bedtime, and only because the parent picked it. */
  overridesBedtime: boolean;
}

/**
 * When an override chosen now ends. Overrides always end: there is no "forever". "Until bedtime"
 * with no bedtime in the next two days falls back to tomorrow morning.
 */
export function overrideWindow(choice: DurationChoice, now: Date, schedules: Schedule[], childId: string, timeZone: string): OverrideWindow {
  const morning = () => {
    const tomorrow = addDays(civilDate(now, timeZone), 1);
    return zonedTime(tomorrow.year, tomorrow.month, tomorrow.day, MORNING_MINUTES, timeZone);
  };
  switch (choice) {
    case '30m':
      return { end: new Date(now.getTime() + 30 * 60_000), overridesBedtime: false };
    case '1h':
      return { end: new Date(now.getTime() + 60 * 60_000), overridesBedtime: false };
    case 'until-bedtime':
      return { end: nextBedtime(schedules, childId, now, timeZone) ?? morning(), overridesBedtime: false };
    case 'until-tomorrow':
      return { end: morning(), overridesBedtime: true };
  }
}
