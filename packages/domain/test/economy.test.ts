import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allowCharge,
  BLOCK_MINUTES,
  checkPlan,
  earnedTimeCap,
  features,
  minutesLost,
  nextAllowance,
  parseWeekReset,
  timeAwardable,
  unusedBonus,
  weekStarting,
  type ReductionPlan,
} from '../src/index.js';
import { at, CHILD, SCHEDULES, TZ } from './fixtures.js';

const RESET = parseWeekReset('SUN 18:00');

describe('the week', () => {
  it('starts at the last reset at or before now, in local time', () => {
    // Monday 26 October 2026: the week began Sunday 25 October at 18:00 (GMT, the day the clocks went back).
    expect(weekStarting(at('2026-10-26 18:32'), RESET, TZ)).toEqual({ start: at('2026-10-25 18:00'), date: '2026-10-25', next: at('2026-11-01 18:00') });
    // Sunday before 18:00 is still last week.
    expect(weekStarting(at('2026-11-01 17:59'), RESET, TZ).date).toBe('2026-10-25');
    expect(weekStarting(at('2026-11-01 18:00'), RESET, TZ).date).toBe('2026-11-01');
  });

  it('keeps 18:00 local across the clock change, so one week is an hour longer', () => {
    const w = weekStarting(at('2026-10-24 12:00'), RESET, TZ);
    expect(w.start.toISOString()).toBe('2026-10-18T17:00:00.000Z'); // BST
    expect(w.next.toISOString()).toBe('2026-10-25T18:00:00.000Z'); // GMT
  });

  it('reads the reset as the household writes it, and refuses anything else', () => {
    expect(parseWeekReset('SAT 09:30')).toEqual({ weekday: 6, minuteOfDay: 570 });
    expect(() => parseWeekReset('Sunday 6pm')).toThrow(/like SUN 18:00/);
  });
});

describe('the unused-time bonus', () => {
  const rule = { pencePerBlock: 10, weeklyCapPence: 100 };

  it('pays for each full 30 minutes left, up to the cap', () => {
    expect(unusedBonus(59, rule)).toBe(10);
    expect(unusedBonus(60, rule)).toBe(20);
    expect(unusedBonus(0, rule)).toBe(0);
    expect(unusedBonus(420, rule)).toBe(100);
  });

  it('never pays more than the cap, never less than nothing', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 10_000 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 1000 }), (left, pence, cap) => {
        const b = unusedBonus(left, { pencePerBlock: pence, weeklyCapPence: cap });
        // Whole blocks only, unless the cap cut it short.
        return b >= 0 && b <= cap && (b === cap || (pence ? b % pence === 0 : b === 0));
      }),
    );
  });
});

describe('earned screen time', () => {
  it('is capped at 15% of the weekly allowance', () => {
    expect(earnedTimeCap(420)).toBe(63);
    expect(timeAwardable(30, 0, 420)).toBe(30);
    expect(timeAwardable(30, 45, 420)).toBe(18);
    expect(timeAwardable(30, 63, 420)).toBe(0);
  });

  it('never lets the week go over the cap, whatever is asked', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 120 }), { maxLength: 20 }), fc.integer({ min: 0, max: 2000 }), (asks, allowance) => {
        let earned = 0;
        for (const a of asks) earned += timeAwardable(a, earned, allowance);
        return earned <= earnedTimeCap(allowance);
      }),
    );
  });
});

describe('the reduction plan', () => {
  const plan: ReductionPlan = { stepMinutes: 30, everyWeeks: 4, floorMinutes: 300, nextStepOn: '2026-11-08', agreedStepOn: null };

  it('only steps down when the step was ticked agreed at the review', () => {
    expect(nextAllowance(420, plan, '2026-11-08')).toEqual({ minutes: 420, stepped: false, plan });
    const agreed = { ...plan, agreedStepOn: '2026-11-08' };
    expect(nextAllowance(420, agreed, '2026-11-08')).toEqual({ minutes: 390, stepped: true, plan: { ...plan, nextStepOn: '2026-12-06', agreedStepOn: null } });
  });

  it('waits for the step date, and a step agreed late applies at the next week', () => {
    const agreed = { ...plan, agreedStepOn: '2026-11-08' };
    expect(nextAllowance(420, agreed, '2026-11-01').stepped).toBe(false);
    expect(nextAllowance(420, agreed, '2026-11-15')).toMatchObject({ minutes: 390, stepped: true });
  });

  it('never goes below the floor, and never goes up', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 0, max: 600 }), fc.integer({ min: 0, max: 3000 }), (current, step, floor) => {
        const r = nextAllowance(current, { stepMinutes: step, everyWeeks: 4, floorMinutes: floor, nextStepOn: '2026-11-08', agreedStepOn: '2026-11-08' }, '2026-11-08');
        return r.minutes <= current && (r.minutes >= floor || r.minutes === current);
      }),
    );
  });

  it('with no plan, the allowance stays as it is', () => {
    expect(nextAllowance(420, null, '2026-11-08')).toEqual({ minutes: 420, stepped: false, plan: null });
  });
});

describe('planning a session', () => {
  const base = { schedules: SCHEDULES, childId: CHILD, timeZone: TZ, now: at('2026-10-26 18:32'), balanceMinutes: 330, plannedToday: 0, overlapsOwn: false };

  it('takes 30-minute blocks in free time, when there is enough time left', () => {
    expect(checkPlan({ ...base, start: at('2026-10-26 18:45'), minutes: 30 })).toEqual({ ok: true });
  });

  it('says why not, in words the child can read', () => {
    expect(checkPlan({ ...base, start: at('2026-10-26 18:45'), minutes: 45 })).toEqual({ ok: false, reason: 'Plan in blocks of 30 minutes.' });
    expect(checkPlan({ ...base, start: at('2026-10-26 19:15'), minutes: 30 })).toEqual({ ok: false, reason: 'Wind-down starts at 19:30.' });
    expect(checkPlan({ ...base, start: at('2026-10-26 17:30'), minutes: 30 })).toEqual({ ok: false, reason: 'That time has gone.' });
    expect(checkPlan({ ...base, start: at('2026-10-27 10:00'), minutes: 30 })).toEqual({ ok: false, reason: 'Planning is for today.' });
    expect(checkPlan({ ...base, start: at('2026-10-26 18:45'), minutes: 30, balanceMinutes: 0 })).toEqual({ ok: false, reason: "You've used this week's time." });
    expect(checkPlan({ ...base, start: at('2026-10-26 18:45'), minutes: 60, sessionCapMinutes: 30 })).toEqual({ ok: false, reason: 'One go can be 30 minutes at most.' });
    expect(checkPlan({ ...base, start: at('2026-10-26 18:45'), minutes: 30, dailyCapMinutes: 60, plannedToday: 60 })).toEqual({ ok: false, reason: "That's today's limit for this one." });
    expect(checkPlan({ ...base, start: at('2026-10-26 18:45'), minutes: 30, overlapsOwn: true })).toEqual({ ok: false, reason: "You've already planned that then." });
  });

  it('a session already under way can start now, rounded to the minute', () => {
    expect(checkPlan({ ...base, start: at('2026-10-26 18:32'), minutes: 30 })).toEqual({ ok: true });
  });
});

describe('minutes a parent took back', () => {
  const grant = { start: at('2026-10-26 18:30'), end: at('2026-10-26 19:00') };

  it('counts the overlap of every Block or Pause with the session, once', () => {
    expect(minutesLost(grant, [{ start: at('2026-10-26 18:40'), end: at('2026-10-26 18:50') }])).toBe(10);
    // Two overlapping blocks are not counted twice; one past the end stops at the end.
    expect(
      minutesLost(grant, [
        { start: at('2026-10-26 18:40'), end: at('2026-10-26 18:50') },
        { start: at('2026-10-26 18:45'), end: at('2026-10-26 19:30') },
      ]),
    ).toBe(20);
    expect(minutesLost(grant, [{ start: at('2026-10-26 17:00'), end: null }])).toBe(30);
    expect(minutesLost(grant, [])).toBe(0);
  });

  it('is never more than the session', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: -60, max: 90 }), fc.integer({ min: 0, max: 120 })), { maxLength: 6 }), (raw) => {
        const blocks = raw.map(([s, len]) => ({ start: new Date(grant.start.getTime() + s * 60_000), end: new Date(grant.start.getTime() + (s + len) * 60_000) }));
        const lost = minutesLost(grant, blocks);
        return lost >= 0 && lost <= 30;
      }),
    );
  });
});

describe('an Allow that counts in weekly time', () => {
  it('charges the minutes it ran, rounded up, and never more than is left', () => {
    expect(allowCharge(at('2026-10-26 18:00'), at('2026-10-26 18:30'), 300)).toBe(30);
    expect(allowCharge(at('2026-10-26 18:00'), new Date(at('2026-10-26 18:10').getTime() + 1000), 300)).toBe(11);
    expect(allowCharge(at('2026-10-26 18:00'), at('2026-10-26 19:00'), 20)).toBe(20);
    expect(allowCharge(at('2026-10-26 18:00'), at('2026-10-26 19:00'), 0)).toBe(0);
  });
});

describe('the pilot phases', () => {
  it('switch features on in the order of the pilot', () => {
    expect(features('baseline')).toEqual({ economy: false, bonus: false, goal: false, taper: false });
    expect(features('reframe')).toEqual({ economy: true, bonus: false, goal: false, taper: false });
    expect(features('reward-less')).toEqual({ economy: true, bonus: true, goal: true, taper: false });
    expect(features('transitions')).toEqual({ economy: true, bonus: true, goal: true, taper: false });
    expect(features('taper')).toEqual({ economy: true, bonus: true, goal: true, taper: true });
  });

  it('a 30-minute block is the unit everywhere', () => {
    expect(BLOCK_MINUTES).toBe(30);
  });
});
