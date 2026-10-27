// Every call this client makes, and every field it sends, must exist in the pinned AdGuard Home
// v0.107.79 OpenAPI spec. Upgrading AdGuard means vendoring the new spec and passing this again.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CALLS, desiredClient, newClient } from '../src/index.js';

type Json = Record<string, unknown>;
const spec = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'spec', 'openapi-v0.107.79.json'), 'utf8')) as Json;
const paths = spec.paths as Record<string, Record<string, Json>>;
const schemas = (spec.components as Json).schemas as Record<string, Json>;

/** Top-level property names of a schema, following $ref and allOf. */
function properties(name: string, seen = new Set<string>()): Set<string> {
  if (seen.has(name)) return new Set();
  seen.add(name);
  const s = schemas[name];
  if (!s) throw new Error(`No schema ${name} in the spec`);
  const out = new Set(Object.keys((s.properties as Json | undefined) ?? {}));
  const ref = (r: unknown) => String(r).split('/').pop()!;
  if (s.$ref) for (const p of properties(ref(s.$ref), seen)) out.add(p);
  for (const part of (s.allOf as Json[] | undefined) ?? []) {
    if (part.$ref) for (const p of properties(ref(part.$ref), seen)) out.add(p);
    for (const p of Object.keys((part.properties as Json | undefined) ?? {})) out.add(p);
  }
  return out;
}

describe('AdGuard v0.107.79 spec', () => {
  it('has a real spec loaded', () => {
    expect((spec.info as Json).version).toBe('0.107');
    expect(Object.keys(paths).length).toBeGreaterThan(50);
  });

  it.each(CALLS.map((c) => [c.method, c.path] as const))('has %s %s', (method, path) => {
    expect(paths[path], `no path ${path}`).toBeDefined();
    expect(paths[path]![method], `no ${method} on ${path}`).toBeDefined();
  });

  it('knows every field we send in a client', () => {
    const client = properties('Client');
    const sent = new Set([...Object.keys(newClient('ft-abc', ['192.168.1.5'], ['youtube'], 'Europe/London')), ...Object.keys(desiredClient({ name: 'x', ids: ['y'] }, [], 'Europe/London'))]);
    expect([...sent].filter((f) => !client.has(f))).toEqual([]);
    expect(properties('ClientUpdate')).toEqual(new Set(['name', 'data']));
    expect(properties('Schedule').has('time_zone')).toBe(true);
  });

  it('knows the other bodies we send', () => {
    expect(properties('SetRulesRequest').has('rules')).toBe(true);
    for (const f of ['name', 'url', 'whitelist']) expect(properties('AddUrlRequest').has(f)).toBe(true);
    for (const f of ['web', 'dns', 'username', 'password']) expect(properties('InitialConfiguration').has(f)).toBe(true);
    for (const f of ['blocked_response_ttl', 'cache_ttl_max']) expect(properties('DNSConfig').has(f)).toBe(true);
    for (const f of ['enabled', 'interval', 'anonymize_client_ip', 'ignored']) expect(properties('GetQueryLogConfigResponse').has(f)).toBe(true);
    for (const f of ['enabled', 'interval', 'ignored']) expect(properties('GetStatsConfigResponse').has(f)).toBe(true);
  });

  it('knows the query log parameters we use', () => {
    const params = (paths['/querylog']!.get!.parameters as Json[]).map((p) => p.name ?? String(p.$ref).split('/').pop());
    expect(params).toEqual(expect.arrayContaining(['older_than', 'limit']));
  });
});
