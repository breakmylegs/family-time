// Trusting the owner's certificate for AdGuard only (ADR 0022).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adguardFetch, fetchTrusting } from '../src/index.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("the AdGuard client's own trusted certificate", () => {
  it("is off unless the owner opted in, leaving Node's own fetch", () => {
    expect(adguardFetch(undefined)).toBeUndefined();
    expect(adguardFetch('')).toBeUndefined();
  });

  it('refuses a file that holds no certificate, and says what to do', () => {
    dir = mkdtempSync(join(tmpdir(), 'ft-ca-'));
    const file = join(dir, 'adguard_ca.pem');
    writeFileSync(file, '');
    expect(() => adguardFetch(file)).toThrow(/holds no certificate/);
  });

  it('is only ever used for an https address', async () => {
    const f = fetchTrusting('-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n');
    await expect(f('http://192.0.2.53:3000/control/status')).rejects.toThrow(/only for an https AdGuard address/);
  });
});
