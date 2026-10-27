// Wall-clock time in a household's time zone, with no library: the platform's Intl does the work.
// Everything is stored in UTC; rules ("bed at 20:30") are local wall-clock times.

export interface LocalParts {
  year: number;
  month: number; // 1 to 12
  day: number;
  hour: number;
  minute: number;
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday!]!,
  };
}

/** Milliseconds the zone is ahead of UTC at this instant, to the minute. */
export function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const floored = Math.floor(instant.getTime() / 60_000) * 60_000;
  return asUtc - floored;
}

/**
 * The instant a local wall-clock time happens. In the spring gap (a time that does not exist),
 * it lands an hour later, the way a wall clock jumps. In the autumn overlap (a time that happens
 * twice), it is the first.
 */
export function zonedTime(year: number, month: number, day: number, minuteOfDay: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  // Clock changes are hours apart at most, so the offsets 6 hours either side bracket any change.
  const before = guess - offsetMs(new Date(guess - 6 * 3_600_000), timeZone);
  const after = guess - offsetMs(new Date(guess + 6 * 3_600_000), timeZone);
  const wanted = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const matches = [before, after].filter((t) => {
    const p = localParts(new Date(t), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wanted;
  });
  // Overlap: both match, take the first. Gap: neither matches, take the pre-change offset, which
  // lands the same distance past the jump as a wall clock would.
  return new Date(matches.length ? Math.min(...matches) : before);
}

/** A calendar date, independent of time zone. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export function civilDate(instant: Date, timeZone: string): CivilDate {
  const p = localParts(instant, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function weekdayOf(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** `"20:30"` to minutes after midnight. Refuses anything else. */
export function parseClock(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new Error(`"${value}" is not a 24-hour time like 20:30`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** `19:00` today, `Tue 07:00` on another day, always 24-hour. */
export function clockLabel(instant: Date, now: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const hhmm = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  const today = civilDate(now, timeZone);
  const sameDay = p.year === today.year && p.month === today.month && p.day === today.day;
  if (sameDay) return hhmm;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.weekday];
  return `${day} ${hhmm}`;
}
