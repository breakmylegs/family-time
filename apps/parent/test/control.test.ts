import type { DayBlock } from '@family-time/schemas';
import { describe, expect, it } from 'vitest';
import { listOf, serviceLine } from '../src/components/DurationSheet';
import { railWindow } from '../src/components/Rail';

const b = (type: DayBlock['type'], start: string, end: string, label: string = type): DayBlock => ({
  type,
  label,
  start: `2026-10-26T${start}:00.000Z`,
  end: `2026-10-26T${end}:00.000Z`,
  startLabel: start,
  endLabel: end,
});
const at = (hhmm: string) => Date.parse(`2026-10-26T${hhmm}:00.000Z`);

const SCHOOL_NIGHT = [
  b('school', '08:30', '15:30'),
  b('free', '15:30', '17:30'),
  b('pause', '17:30', '18:15', 'Tea'),
  b('free', '18:15', '19:30'),
  b('wind-down', '19:30', '20:30'),
  b('bed', '20:30', '23:59'),
];

describe('the rail', () => {
  it("shows the mock's evening after school: 15:30 to an hour into bed", () => {
    expect(railWindow(SCHOOL_NIGHT, at('18:32'))).toEqual({ start: at('15:30'), end: at('21:30') });
  });

  it('starts at the block now is in during school', () => {
    expect(railWindow(SCHOOL_NIGHT, at('10:00'))?.start).toBe(at('08:30'));
  });

  it('keeps now on the bar late in the evening', () => {
    const w = railWindow(SCHOOL_NIGHT, at('22:30'))!;
    expect(w.end).toBeGreaterThanOrEqual(at('22:30'));
  });

  it('has nothing to show on a day with no schedule', () => {
    expect(railWindow([], at('12:00'))).toBeUndefined();
  });
});

describe('words on the sheet', () => {
  it('lists services the way people say them', () => {
    expect(listOf(['YouTube'])).toBe('YouTube');
    expect(listOf(['YouTube', 'Roblox', 'Minecraft'])).toBe('YouTube, Roblox and Minecraft');
  });

  it('says the state and, when there is one, the end', () => {
    expect(serviceLine({ state: 'allowed', untilLabel: '19:00' })).toBe('Allowed until 19:00');
    expect(serviceLine({ state: 'blocked', untilLabel: null })).toBe('Blocked');
    expect(serviceLine({ state: 'paused', untilLabel: 'Tue 07:00' })).toBe('Paused until Tue 07:00');
  });
});
