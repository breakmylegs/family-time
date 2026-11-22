// Which AdGuard versions Family time goes ahead with (ADR 0022).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkVersion, TESTED_VERSION } from '../src/index.js';

describe('AdGuard version check', () => {
  it('accepts the tested version, with nothing to say', () => {
    expect(checkVersion(`v${TESTED_VERSION}`)).toEqual({ ok: true, level: 'tested', message: '' });
  });

  it('accepts a later patch in the tested series, with a note', () => {
    const c = checkVersion('v0.107.85');
    expect(c).toMatchObject({ ok: true, level: 'newer-patch' });
    expect(c.message).toMatch(/newer than the tested v0\.107\.79/);
  });

  it('refuses anything older, and says to update', () => {
    for (const v of ['v0.107.78', 'v0.106.3']) expect(checkVersion(v)).toMatchObject({ ok: false, level: 'too-old' });
    expect(checkVersion('v0.107.12', true)).toMatchObject({ ok: false, level: 'too-old' });
  });

  it('refuses a newer series unless the owner opts in', () => {
    for (const v of ['v0.108.0', 'v1.0.0']) {
      const c = checkVersion(v);
      expect(c).toMatchObject({ ok: false, level: 'untested-series' });
      expect(c.message).toMatch(/ADGUARD_ALLOW_UNTESTED=1/);
      expect(checkVersion(v, true)).toMatchObject({ ok: true, level: 'untested-series' });
    }
  });

  it('refuses a version it cannot read', () => {
    expect(checkVersion('edge')).toMatchObject({ ok: false, level: 'unknown' });
  });

  it('is the same tested version update.sh checks before a deploy', () => {
    const lib = readFileSync(fileURLToPath(new URL('../../../scripts/lib/deploy-lib.sh', import.meta.url)), 'utf8');
    expect(/^ADGUARD_TESTED=(\S+)$/m.exec(lib)?.[1]).toBe(TESTED_VERSION);
  });
});
