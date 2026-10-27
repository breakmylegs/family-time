// What the Control screen's shell shows: the day's rhythm (the rail) and one plain sentence about
// now. Pure, like the engine; the server sends the result, so the app never works out times.
import { overrideWindow, type DurationChoice } from './durations.js';
import { blocksAround, blocksOn, nextBedtime, type BlockInterval, type BlockType, type Schedule } from './schedule.js';
import { civilDate, clockLabel } from './time.js';

export interface DayBlock {
  type: BlockType;
  label: string;
  /** Instants, so the app can place them on the rail. */
  start: string;
  end: string;
  /** 24-hour local times, for the labels. */
  startLabel: string;
  endLabel: string;
}

export interface Headline {
  /** Bold part: "Free time now." */
  lead: string;
  /** The rest: "Wind-down starts at 19:30." */
  rest: string;
}

const NAMES: Record<BlockType, string> = { school: 'School', pause: 'Pause', 'wind-down': 'Wind-down', bed: 'Bed', free: 'Free time' };

function name(b: { type: BlockType; label?: string }): string {
  return b.label ?? NAMES[b.type];
}

/** Today's blocks for the rail, in order. Bed is cut at midnight for display. */
export function dayBlocks(schedules: Schedule[], childId: string, now: Date, timeZone: string): DayBlock[] {
  const today = civilDate(now, timeZone);
  return blocksOn(schedules, childId, today, timeZone)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((b) => ({
      type: b.type,
      label: name(b),
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      startLabel: clockLabel(b.start, b.start, timeZone),
      endLabel: clockLabel(b.end, b.end, timeZone),
    }));
}

/** The sentence at the top of Control. Pause everything, when on, is the parent's to describe. */
export function headline(schedules: Schedule[], childId: string, now: Date, timeZone: string): Headline {
  const t = now.getTime();
  const blocks: BlockInterval[] = blocksAround(schedules, childId, now, timeZone, 1, 1);
  const current = blocks.filter((b) => b.start.getTime() <= t && t < b.end.getTime()).sort((a, b) => b.start.getTime() - a.start.getTime())[0];
  const next = blocks.find((b) => b.start.getTime() > t && b.type !== 'free');
  const at = (d: Date) => clockLabel(d, now, timeZone);
  if (!current) {
    return { lead: 'Nothing scheduled now.', rest: next ? `${name(next)} starts at ${at(next.start)}.` : 'No schedule set for today.' };
  }
  switch (current.type) {
    case 'free':
      return { lead: 'Free time now.', rest: next ? `${name(next)} starts at ${at(next.start)}.` : '' };
    case 'pause':
      return { lead: `${name(current)} now.`, rest: `Everything is paused until ${at(current.end)}.` };
    case 'school':
      return { lead: `${current.label ?? 'School time'} now.`, rest: `Free time from ${at(current.end)}.` };
    case 'wind-down':
      return { lead: 'Wind-down now.', rest: `Bed at ${at(current.end)}.` };
    case 'bed':
      return { lead: 'Bedtime.', rest: `Until ${at(current.end)}.` };
  }
}

export interface DurationOption {
  choice: DurationChoice;
  label: string;
  /** "until 19:02", "until Tue 07:00". */
  until: string;
  end: string;
  /** A warning worth reading before choosing, for an Allow: "Runs into wind-down". */
  note?: string;
  overridesBedtime: boolean;
}

const LABELS: Record<DurationChoice, string> = { '30m': 'For 30 minutes', '1h': 'For 1 hour', 'until-bedtime': 'Until bedtime', 'until-tomorrow': 'Until tomorrow' };

/** The sheet's choices with their real end times, and, for an Allow, what each runs into. */
export function durationOptions(kind: 'allow' | 'block' | 'pause', schedules: Schedule[], childId: string, now: Date, timeZone: string): DurationOption[] {
  const bed = nextBedtime(schedules, childId, now, timeZone);
  const windDown = blocksAround(schedules, childId, now, timeZone, 0, 1).find((b) => b.type === 'wind-down' && b.start.getTime() > now.getTime());
  const choices: DurationChoice[] = kind === 'pause' ? ['30m', '1h', 'until-bedtime'] : ['30m', '1h', 'until-bedtime', 'until-tomorrow'];
  return choices.map((choice) => {
    const w = overrideWindow(choice, now, schedules, childId, timeZone);
    let note: string | undefined;
    if (kind === 'allow') {
      if (choice === 'until-tomorrow') note = 'Runs through bedtime';
      else if (choice === 'until-bedtime' && windDown && windDown.start < w.end) note = 'Overrides wind-down';
      else if (windDown && windDown.start < w.end && (!bed || w.end <= bed)) note = 'Runs into wind-down';
    }
    return { choice, label: LABELS[choice], until: `until ${clockLabel(w.end, now, timeZone)}`, end: w.end.toISOString(), overridesBedtime: kind === 'allow' && w.overridesBedtime, ...(note ? { note } : {}) };
  });
}
