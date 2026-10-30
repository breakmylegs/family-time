import { describe, expect, it } from 'vitest';
import { dayBlocks, durationOptions, headline } from '../src/index.js';
import { at, CHILD, SCHEDULES, TZ } from './fixtures.js';

describe('the day view', () => {
  it('says what now is, and what comes next', () => {
    expect(headline(SCHEDULES, CHILD, at('2026-10-26 18:32'), TZ)).toEqual({ lead: 'Free time now.', rest: 'Wind-down starts at 19:30.' });
    expect(headline(SCHEDULES, CHILD, at('2026-10-26 17:45'), TZ)).toEqual({ lead: 'Tea now.', rest: 'Everything is paused until 18:15.' });
    expect(headline(SCHEDULES, CHILD, at('2026-10-26 10:00'), TZ)).toEqual({ lead: 'School time now.', rest: 'Free time from 15:30.' });
    expect(headline(SCHEDULES, CHILD, at('2026-10-26 19:45'), TZ)).toEqual({ lead: 'Wind-down now.', rest: 'Bed at 20:30.' });
    expect(headline(SCHEDULES, CHILD, at('2026-10-26 23:00'), TZ)).toEqual({ lead: 'Bedtime now.', rest: 'Apps are blocked until Tue 07:00.' });
  });

  it('lists today in order, with 24-hour labels', () => {
    const blocks = dayBlocks(SCHEDULES, CHILD, at('2026-10-26 18:32'), TZ);
    expect(blocks.map((b) => `${b.label} ${b.startLabel}`)).toEqual(['School 08:30', 'Free time 15:30', 'Tea 17:30', 'Free time 18:15', 'Wind-down 19:30', 'Bed 20:30']);
  });

  it('gives each sheet choice its real end time, and warns an Allow about what it runs into', () => {
    const allow = durationOptions('allow', SCHEDULES, CHILD, at('2026-10-26 18:32'), TZ);
    expect(allow.map((o) => [o.label, o.until, o.note ?? null])).toEqual([
      ['For 30 minutes', 'until 19:02', null],
      ['For 1 hour', 'until 19:32', 'Runs into wind-down'],
      ['Until bedtime', 'until 20:30', 'Runs through wind-down'],
      ['Until tomorrow', 'until Tue 07:00', 'Runs through bedtime'],
    ]);
    expect(allow[3]!.overridesBedtime).toBe(true);
    const pause = durationOptions('pause', SCHEDULES, CHILD, at('2026-10-26 18:32'), TZ);
    expect(pause.map((o) => o.label)).toEqual(['For 30 minutes', 'For 1 hour', 'Until bedtime']);
    expect(pause.every((o) => !o.note && !o.overridesBedtime)).toBe(true);
  });
});
