import { describe, expect, it } from 'vitest';
import { decide, overrideWindow, type Grant, type Override } from '../src/index.js';
import { at, CHILD, rules, SCHEDULES, TZ } from './fixtures.js';

const allow = (id: string, start: string, end: string | null, extra: Partial<Override> = {}): Override => ({
  id,
  childId: CHILD,
  target: { kind: 'service', id: 'roblox' },
  type: 'allow',
  start: at(start),
  end: end ? at(end) : null,
  createdByName: 'Mum',
  ...extra,
});

describe('a school night (Monday 26 October 2026)', () => {
  it('blocks at school, naming the end', () => {
    const d = decide(rules(), 'youtube', at('2026-10-26 10:00'));
    expect(d).toMatchObject({ state: 'blocked', layer: 'schedule', reason: 'School time until 15:30.' });
  });

  it('is blocked in free time when nothing is planned, with the usual rule', () => {
    const d = decide(rules(), 'roblox', at('2026-10-26 16:00'));
    expect(d).toMatchObject({ state: 'blocked', layer: 'default', reason: 'Not planned today. Usual school night rule.' });
  });

  it('pauses everything at tea', () => {
    const d = decide(rules(), 'youtube', at('2026-10-26 17:45'));
    expect(d).toMatchObject({ state: 'paused', layer: 'pause', reason: 'Tea. Everything is paused until 18:15.' });
  });

  it('allows a planned session, then blocks when it ends', () => {
    const grant: Grant = {
      id: 'g1',
      childId: CHILD,
      target: { kind: 'service', id: 'youtube' },
      start: at('2026-10-26 18:30'),
      end: at('2026-10-26 19:00'),
      source: 'planned',
      status: 'scheduled',
    };
    const d = decide(rules({ grants: [grant] }), 'youtube', at('2026-10-26 18:32'));
    expect(d).toMatchObject({ state: 'allowed', layer: 'allowed-time', reason: 'Ollie planned 30 minutes of screen time.', sourceId: 'g1' });
    expect(d.until).toEqual(at('2026-10-26 19:00'));
    expect(decide(rules({ grants: [grant] }), 'youtube', at('2026-10-26 19:00')).state).toBe('blocked');
  });

  it('lets an always-allowed service through wind-down only when it is marked for it', () => {
    expect(decide(rules(), 'facetime', at('2026-10-26 19:45'))).toMatchObject({ state: 'allowed', reason: 'Always allowed.' });
    expect(decide(rules(), 'khan', at('2026-10-26 19:45'))).toMatchObject({ state: 'blocked', layer: 'schedule' });
  });

  it('blocks everything at bedtime, even always-allowed services', () => {
    const d = decide(rules(), 'facetime', at('2026-10-26 22:00'));
    expect(d).toMatchObject({ state: 'blocked', reason: 'Bedtime until Tue 07:00.' });
  });
});

describe('parent overrides', () => {
  it('beat school and wind-down, and say who and until when', () => {
    const r = rules({ overrides: [allow('o1', '2026-10-26 10:00', '2026-10-26 11:00')] });
    expect(decide(r, 'roblox', at('2026-10-26 10:15'))).toMatchObject({ state: 'allowed', layer: 'override', reason: 'Mum allowed it until 11:00.' });
  });

  it('stop at bedtime unless the parent chose to run through it', () => {
    const plain = rules({ overrides: [allow('o1', '2026-10-26 19:00', '2026-10-27 07:00')] });
    expect(decide(plain, 'roblox', at('2026-10-26 21:00')).state).toBe('blocked');
    expect(decide(plain, 'roblox', at('2026-10-26 19:45')).state).toBe('allowed');
    const through = rules({ overrides: [allow('o1', '2026-10-26 19:00', '2026-10-27 07:00', { overridesBedtime: true })] });
    expect(decide(through, 'roblox', at('2026-10-26 21:00'))).toMatchObject({ state: 'allowed', layer: 'override' });
  });

  it('give way to a pause, scheduled or manual', () => {
    const r = rules({ overrides: [allow('o1', '2026-10-26 17:00', '2026-10-26 19:00')] });
    expect(decide(r, 'roblox', at('2026-10-26 17:45')).state).toBe('paused');
    const pause: Override = { id: 'p1', childId: CHILD, target: { kind: 'everything' }, type: 'pause', start: at('2026-10-26 18:20'), end: null, createdByName: 'Dad' };
    expect(decide(rules({ overrides: [allow('o1', '2026-10-26 18:15', '2026-10-26 19:00'), pause] }), 'roblox', at('2026-10-26 18:30'))).toMatchObject({
      state: 'paused',
      reason: 'Paused by Dad until they resume.',
    });
  });

  it('newest wins when two overlap, and a block beats a planned grant', () => {
    const block: Override = { ...allow('b1', '2026-10-26 18:40', '2026-10-26 19:10'), type: 'block', createdByName: 'Dad' };
    const grant: Grant = { id: 'g1', childId: CHILD, target: { kind: 'service', id: 'roblox' }, start: at('2026-10-26 18:30'), end: at('2026-10-26 19:00'), source: 'planned', status: 'active' };
    const r = rules({ overrides: [allow('o1', '2026-10-26 18:30', '2026-10-26 19:20'), block], grants: [grant] });
    expect(decide(r, 'roblox', at('2026-10-26 18:45'))).toMatchObject({ state: 'blocked', reason: 'Dad blocked it until 19:10.' });
  });

  it('match a group or everything', () => {
    const r = rules({ overrides: [{ ...allow('o1', '2026-10-26 16:00', '2026-10-26 17:00'), target: { kind: 'group', id: 'games' } }] });
    expect(decide(r, 'roblox', at('2026-10-26 16:30')).state).toBe('allowed');
    expect(decide(r, 'youtube', at('2026-10-26 16:30')).state).toBe('blocked');
  });
});

describe('durations', () => {
  const now = at('2026-10-26 18:32');
  it('end where the sheet says', () => {
    expect(overrideWindow('30m', now, SCHEDULES, CHILD, TZ)).toEqual({ end: at('2026-10-26 19:02'), overridesBedtime: false });
    expect(overrideWindow('1h', now, SCHEDULES, CHILD, TZ).end).toEqual(at('2026-10-26 19:32'));
    expect(overrideWindow('until-bedtime', now, SCHEDULES, CHILD, TZ)).toEqual({ end: at('2026-10-26 20:30'), overridesBedtime: false });
    expect(overrideWindow('until-tomorrow', now, SCHEDULES, CHILD, TZ)).toEqual({ end: at('2026-10-27 07:00'), overridesBedtime: true });
  });

  it('find bedtime on the night the clocks go back', () => {
    // Saturday 24 October: weekend bed at 21:00, and the clocks change overnight.
    const sat = at('2026-10-24 19:00');
    expect(overrideWindow('until-bedtime', sat, SCHEDULES, CHILD, TZ).end).toEqual(at('2026-10-24 21:00'));
    expect(overrideWindow('until-tomorrow', sat, SCHEDULES, CHILD, TZ).end.toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });
});

describe('the clock change', () => {
  it('keeps bedtime at 07:30 on the autumn Sunday morning, now GMT', () => {
    const d = decide(rules(), 'youtube', at('2026-10-25 06:00'));
    expect(d.state).toBe('blocked');
    expect(d.until?.toISOString()).toBe('2026-10-25T07:30:00.000Z');
  });

  it('keeps bedtime at 07:30 on the spring Sunday morning, now BST', () => {
    const d = decide(rules(), 'youtube', at('2026-03-29 06:00'));
    expect(d.until?.toISOString()).toBe('2026-03-29T06:30:00.000Z');
  });
});
