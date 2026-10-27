// Properties that must hold for any rules at any moment, checked over thousands of random cases
// that span both clock changes in 2026.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decide, overrideWindow, DURATIONS, type Grant, type Override, type Rules } from '../src/index.js';
import { CHILD, rules, SCHEDULES, SERVICES, TZ } from './fixtures.js';

const DASHES = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);

// Instants between 1 March and 30 November 2026 (both clock changes), to the minute.
const START = Date.UTC(2026, 2, 1);
const END = Date.UTC(2026, 10, 30);
const instant = fc.integer({ min: START / 60_000, max: END / 60_000 }).map((m) => new Date(m * 60_000));
const serviceId = fc.constantFrom(...SERVICES.map((s) => s.id));
const target = fc.oneof(
  fc.constant({ kind: 'everything' as const }),
  serviceId.map((id) => ({ kind: 'service' as const, id })),
  fc.constantFrom('video', 'games', 'chat').map((id) => ({ kind: 'group' as const, id })),
);

/** An override somewhere within a day of `around`. */
function overrideNear(around: Date, i: number) {
  return fc.record({
    type: fc.constantFrom('allow' as const, 'block' as const, 'pause' as const),
    target,
    startOffset: fc.integer({ min: -720, max: 720 }),
    length: fc.option(fc.integer({ min: 1, max: 900 }), { nil: null }),
    overridesBedtime: fc.boolean(),
  }).map((o): Override => {
    const start = new Date(around.getTime() + o.startOffset * 60_000);
    return {
      id: `o${i}`,
      childId: CHILD,
      target: o.target,
      type: o.type,
      start,
      end: o.length === null ? null : new Date(start.getTime() + o.length * 60_000),
      createdByName: 'Mum',
      overridesBedtime: o.overridesBedtime,
    };
  });
}

function grantNear(around: Date, i: number) {
  return fc.record({ service: serviceId, startOffset: fc.integer({ min: -240, max: 240 }), blocks: fc.integer({ min: 1, max: 4 }) }).map(
    (g): Grant => {
      const start = new Date(around.getTime() + g.startOffset * 60_000);
      return { id: `g${i}`, childId: CHILD, target: { kind: 'service', id: g.service }, start, end: new Date(start.getTime() + g.blocks * 30 * 60_000), source: 'planned', status: 'scheduled' };
    },
  );
}

const scenario = instant.chain((now) =>
  fc.record({
    now: fc.constant(now),
    service: serviceId,
    overrides: fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 4 }).chain((ids) => fc.tuple(...ids.map((_, i) => overrideNear(now, i)))),
    grants: fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 3 }).chain((ids) => fc.tuple(...ids.map((_, i) => grantNear(now, i)))),
  }),
);

const live = (o: Override, t: Date, service: string) => {
  const s = SERVICES.find((x) => x.id === service)!;
  const matches = o.target.kind === 'everything' || (o.target.kind === 'service' ? o.target.id === service : s.groupIds.includes(o.target.id));
  return matches && o.start <= t && (o.end === null || t < o.end);
};

const RUNS = { numRuns: 1500 };

describe('precedence', () => {
  it('a live pause always wins', () => {
    fc.assert(
      fc.property(scenario, ({ now, service, overrides, grants }) => {
        const r: Rules = rules({ overrides, grants });
        if (overrides.some((o) => o.type === 'pause' && live(o, now, service))) {
          expect(decide(r, service, now).state).toBe('paused');
        }
      }),
      RUNS,
    );
  });

  it('with no pause, the newest live block always blocks', () => {
    fc.assert(
      fc.property(scenario, ({ now, service, overrides, grants }) => {
        const r = rules({ overrides, grants });
        const d = decide(r, service, now);
        if (d.layer === 'pause') return;
        const liveOnes = overrides.filter((o) => o.type !== 'pause' && live(o, now, service)).sort((a, b) => b.start.getTime() - a.start.getTime());
        if (liveOnes[0]?.type === 'block') expect(d.state).toBe('blocked');
      }),
      RUNS,
    );
  });

  it('nothing but a parent allows anything at bedtime, and only if they chose to run through it', () => {
    fc.assert(
      fc.property(scenario, ({ now, service, overrides, grants }) => {
        const d = decide(rules({ overrides, grants }), service, now);
        if (d.state === 'allowed' && /Bedtime/.test(decide(rules(), service, now).reason)) {
          const source = overrides.find((o) => o.id === d.sourceId);
          expect(source?.type).toBe('allow');
          expect(source?.overridesBedtime).toBe(true);
        }
      }),
      RUNS,
    );
  });
});

describe('expiry and until', () => {
  it('nothing comes from an override after it ends', () => {
    fc.assert(
      fc.property(scenario, ({ now, service, overrides, grants }) => {
        const d = decide(rules({ overrides, grants }), service, now);
        const source = overrides.find((o) => o.id === d.sourceId);
        if (source?.end) expect(now.getTime()).toBeLessThan(source.end.getTime());
      }),
      RUNS,
    );
  });

  it('holds until `until`, and changes exactly then', () => {
    fc.assert(
      fc.property(scenario, ({ now, service, overrides, grants }) => {
        const r = rules({ overrides, grants });
        const d = decide(r, service, now);
        if (!d.until) return;
        expect(d.until.getTime()).toBeGreaterThan(now.getTime());
        const before = decide(r, service, new Date(d.until.getTime() - 1));
        expect([before.state, before.layer, before.sourceId]).toEqual([d.state, d.layer, d.sourceId]);
        const after = decide(r, service, d.until);
        expect([after.state, after.layer, after.sourceId]).not.toEqual([d.state, d.layer, d.sourceId]);
      }),
      { numRuns: 600 },
    );
  });

  it('always gives a sentence, with no dashes', () => {
    fc.assert(
      fc.property(scenario, ({ now, service, overrides, grants }) => {
        const d = decide(rules({ overrides, grants }), service, now);
        expect(d.reason.length).toBeGreaterThan(3);
        expect(d.reason).toMatch(/\.$/);
        expect(DASHES.test(d.reason)).toBe(false);
      }),
      RUNS,
    );
  });

  it('every override duration ends in the future, within a day and a half', () => {
    fc.assert(
      fc.property(instant, fc.constantFrom(...DURATIONS), (now, choice) => {
        const w = overrideWindow(choice, now, SCHEDULES, CHILD, TZ);
        expect(w.end.getTime()).toBeGreaterThan(now.getTime());
        expect(w.end.getTime() - now.getTime()).toBeLessThanOrEqual(36 * 3_600_000);
      }),
      RUNS,
    );
  });
});
