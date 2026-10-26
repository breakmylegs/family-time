import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectionConfig, readSecret } from '../src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'ft-secrets-'));

describe('readSecret', () => {
  it('prefers the file over the plain variable, and trims it', () => {
    const file = join(dir, 'pw');
    writeFileSync(file, 's3cret\n');
    expect(readSecret('PGPASSWORD', { PGPASSWORD_FILE: file, PGPASSWORD: 'plain' })).toBe('s3cret');
  });

  it('treats a missing file as an error, not an empty secret', () => {
    expect(() => readSecret('PGPASSWORD', { PGPASSWORD_FILE: join(dir, 'nope') })).toThrow(/cannot be read/);
  });

  it('treats an empty file as an error', () => {
    const file = join(dir, 'empty');
    writeFileSync(file, '  \n');
    expect(() => readSecret('PGPASSWORD', { PGPASSWORD_FILE: file })).toThrow(/is empty/);
  });

  it('returns undefined when neither is set', () => {
    expect(readSecret('PGPASSWORD', {})).toBeUndefined();
  });
});

describe('connectionConfig', () => {
  it('uses DATABASE_URL when given', () => {
    expect(connectionConfig({ DATABASE_URL: 'postgres://a@b/c' })).toEqual({ connectionString: 'postgres://a@b/c' });
  });

  it('defaults to the Compose service names', () => {
    const file = join(dir, 'pw2');
    writeFileSync(file, 'pw');
    expect(connectionConfig({ PGPASSWORD_FILE: file })).toEqual({
      host: 'postgres',
      port: 5432,
      user: 'family_time',
      database: 'family_time',
      password: 'pw',
    });
  });
});
