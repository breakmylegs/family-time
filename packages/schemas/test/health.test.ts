import { describe, expect, it } from 'vitest';
import { Readiness, Version } from '../src/index.js';

describe('health schemas', () => {
  it('accept a not-ready answer with a reason', () => {
    const body = { status: 'not_ready', checks: [{ name: 'worker', ok: false, detail: 'no heartbeat yet', ms: 3 }] };
    expect(Readiness.parse(body)).toEqual(body);
  });

  it('refuse an unknown status', () => {
    expect(() => Readiness.parse({ status: 'maybe', checks: [] })).toThrow();
  });

  it('require every version field', () => {
    expect(() => Version.parse({ app: 'family-time', commit: 'abc' })).toThrow();
  });
});
