import { auditEvents, people } from '@family-time/db';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CliError, ownerInvite, recoveryLink } from '../src/cli/commands.js';
import { harness, NOW, type Harness } from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const lookup = (app: Harness['app'], link: string) =>
  app.inject({ method: 'POST', url: '/api/invites/lookup', headers: { origin: new URL(link).origin }, payload: { token: link.split('#')[1] } });

describe('owner-invite', () => {
  it('sets up the household and origin, and makes a working 24-hour owner link', async () => {
    h = await harness();
    const result = await ownerInvite(h.handle.db, { origin: 'https://family.example.com/', ownerName: 'Dad', familyName: 'The Testers' }, NOW);
    expect(result.link).toMatch(/^https:\/\/family\.example\.com\/join#[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt.getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000);
    expect((await lookup(h.app, result.link)).json()).toEqual({ kind: 'join', householdName: 'The Testers', displayName: 'Dad', role: 'owner' });
    const events = await h.handle.db.select().from(auditEvents).where(eq(auditEvents.action, 'setup.owner_invite_issued'));
    expect(events[0]).toMatchObject({ actorLabel: 'cli', actorPersonId: null });
  });

  it('refuses plain http except on localhost', async () => {
    h = await harness();
    await expect(ownerInvite(h.handle.db, { origin: 'http://family.example.com' }, NOW)).rejects.toThrow(/https/);
    await expect(ownerInvite(h.handle.db, { origin: 'not a url' }, NOW)).rejects.toThrow(/not a URL/);
    await ownerInvite(h.handle.db, { origin: 'http://localhost:5174' }, NOW);
  });

  it('refuses once an owner exists, and refuses to move the address', async () => {
    h = await harness();
    await ownerInvite(h.handle.db, { origin: 'https://family.example.com' }, NOW);
    await expect(ownerInvite(h.handle.db, { origin: 'https://other.example.com' }, NOW)).rejects.toThrow(/already set up for/);
    const [household] = await h.handle.client.query<{ id: string }>('select id from households').then((r) => r.rows);
    await h.handle.db.insert(people).values({ householdId: household!.id, displayName: 'Dad', role: 'owner' });
    await expect(ownerInvite(h.handle.db, { origin: 'https://family.example.com' }, NOW)).rejects.toThrow(CliError);
  });
});

describe('recovery-link', () => {
  it('makes a 30-minute link for the only owner', async () => {
    h = await harness();
    await ownerInvite(h.handle.db, { origin: 'https://family.example.com', familyName: 'The Testers' }, NOW);
    const [household] = await h.handle.client.query<{ id: string }>('select id from households').then((r) => r.rows);
    await h.handle.db.insert(people).values({ householdId: household!.id, displayName: 'Dad', role: 'owner' });
    const result = await recoveryLink(h.handle.db, {}, NOW);
    expect(result.for).toBe('Dad');
    expect(result.expiresAt.getTime() - NOW.getTime()).toBe(30 * 60 * 1000);
    expect((await lookup(h.app, result.link)).json()).toEqual({ kind: 'recovery', householdName: 'The Testers', displayName: 'Dad', role: 'owner' });
  });

  it('asks which owner when there are several', async () => {
    h = await harness();
    await ownerInvite(h.handle.db, { origin: 'https://family.example.com' }, NOW);
    const [household] = await h.handle.client.query<{ id: string }>('select id from households').then((r) => r.rows);
    await h.handle.db.insert(people).values([
      { householdId: household!.id, displayName: 'Dad', role: 'owner' },
      { householdId: household!.id, displayName: 'Mum', role: 'owner' },
    ]);
    await expect(recoveryLink(h.handle.db, {}, NOW)).rejects.toThrow(/more than one owner[\s\S]*Dad[\s\S]*Mum/);
    expect((await recoveryLink(h.handle.db, { person: 'mum' }, NOW)).for).toBe('Mum');
  });

  it('says what to do when nothing is set up', async () => {
    h = await harness();
    await expect(recoveryLink(h.handle.db, {}, NOW)).rejects.toThrow(/owner-invite first/);
  });
});

describe('the command line', () => {
  // Proves the CLI never pulls in the web server: it must run on its own, even if the api is broken.
  it('never imports Fastify, directly or through a module it imports', () => {
    const src = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const seen = new Set<string>();
    const offenders: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/^import\s+(type\s+)?[^'"]*from\s+'([^']+)'/gm)) {
        const typeOnly = Boolean(m[1]);
        const target = m[2]!;
        if (target === 'fastify' && !typeOnly) offenders.push(file);
        if (target.startsWith('.')) visit(join(dirname(file), target.replace(/\.js$/, '.ts')));
      }
    };
    visit(join(src, 'cli.ts'));
    expect(seen.size).toBeGreaterThanOrEqual(5); // floor: the walk really followed the imports
    expect(offenders).toEqual([]);
  });
});
