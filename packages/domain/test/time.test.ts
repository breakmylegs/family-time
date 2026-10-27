import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clockLabel, localParts, offsetMs, parseClock, zonedTime } from '../src/index.js';
import { at, TZ } from './fixtures.js';

describe('time zones', () => {
  it('knows British Summer Time from Greenwich Mean Time', () => {
    expect(offsetMs(new Date('2026-07-01T12:00:00Z'), TZ)).toBe(3_600_000);
    expect(offsetMs(new Date('2026-12-01T12:00:00Z'), TZ)).toBe(0);
  });

  it('puts a spring-gap time an hour later, like a wall clock', () => {
    // 29 March 2026: clocks go from 01:00 to 02:00. 01:30 does not exist.
    const t = zonedTime(2026, 3, 29, 90, TZ);
    expect(t.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(localParts(t, TZ)).toMatchObject({ hour: 2, minute: 30 });
  });

  it('takes the first of an autumn time that happens twice', () => {
    // 25 October 2026: 01:30 happens at 00:30 UTC (BST) and again at 01:30 UTC (GMT).
    expect(zonedTime(2026, 10, 25, 90, TZ).toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('round-trips every real local time, over two years of days', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 730 }), fc.integer({ min: 0, max: 1439 }), (dayOffset, minute) => {
        const d = new Date(Date.UTC(2026, 0, 1 + dayOffset));
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const day = d.getUTCDate();
        const t = zonedTime(y, m, day, minute, TZ);
        const p = localParts(t, TZ);
        const landed = p.hour * 60 + p.minute;
        if (landed === minute) {
          expect([p.year, p.month, p.day]).toEqual([y, m, day]);
        } else {
          // Only inside the spring gap, and then exactly an hour on.
          expect(landed).toBe(minute + 60);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('reads 24-hour clock times and refuses anything else', () => {
    expect(parseClock('20:30')).toBe(1230);
    expect(parseClock('00:00')).toBe(0);
    for (const bad of ['8:30', '24:00', '20:60', '8.30pm', '']) expect(() => parseClock(bad)).toThrow(/24-hour/);
  });

  it('labels today by time and other days by weekday', () => {
    const now = at('2026-10-26 18:32');
    expect(clockLabel(at('2026-10-26 19:00'), now, TZ)).toBe('19:00');
    expect(clockLabel(at('2026-10-27 07:00'), now, TZ)).toBe('Tue 07:00');
  });
});
