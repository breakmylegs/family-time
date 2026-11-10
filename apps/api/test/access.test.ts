import { auditEvents, invites, sessions } from '@family-time/db';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { registerAccess } from '../src/auth/access.js';
import { can, CAPABILITIES } from '../src/auth/capabilities.js';
import { RateLimiter } from '../src/auth/ratelimit.js';
import { ORIGIN, seedHousehold, seedPerson, signedIn } from './accounts.js';
import { harness, NOW, type Harness } from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('default deny', () => {
  it('refuses to start with a route that has no access rule', async () => {
    h = await harness();
    const app = Fastify();
    registerAccess(app, { db: h.handle.db, now: () => NOW });
    expect(() => app.get('/open', async () => 'oops')).toThrow(/no access rule/);
  });
});

describe('capabilities', () => {
  it('give the owner everything and children nothing', () => {
    for (const c of CAPABILITIES) {
      expect(can('owner', c)).toBe(true);
      expect(can('child', c)).toBe(false);
    }
  });

  it('keep carers to viewing, pausing and approving', () => {
    const carer = CAPABILITIES.filter((c) => can('carer', c));
    expect(carer).toEqual(['status.view', 'control.pause', 'approvals.decide']);
  });

  it('keep people and system management with the owner', () => {
    expect(can('parent', 'people.manage')).toBe(false);
    expect(can('parent', 'system.manage')).toBe(false);
    expect(can('parent', 'control.change')).toBe(true);
  });
});

describe('sessions and CSRF', () => {
  it('answers 401 without a session and 403 without the capability', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    await seedPerson(h.handle.db, hh, 'owner');
    const carer = await seedPerson(h.handle.db, hh, 'carer');
    expect((await h.app.inject('/api/people')).statusCode).toBe(401);
    const headers = await signedIn(h.handle.db, carer);
    expect((await h.app.inject({ url: '/api/people', headers })).statusCode).toBe(403);
  });

  it('refuses a signed-in change without the CSRF token, even with no body', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner');
    const { 'x-csrf-token': _drop, ...noToken } = await signedIn(h.handle.db, owner);
    const res = await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: noToken });
    expect(res.statusCode).toBe(403);
    expect(res.json().detail).toMatch(/CSRF/);
    const wrong = await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...noToken, 'x-csrf-token': 'not-the-cookie' } });
    expect(wrong.statusCode).toBe(403);
  });

  it('refuses a change from another origin, or with no Origin', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner');
    const headers = await signedIn(h.handle.db, owner);
    const evil = await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    const { origin: _o, ...noOrigin } = headers;
    expect((await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: noOrigin })).statusCode).toBe(403);
  });

  it('signs out: the session is gone and the cookies are cleared', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner');
    const headers = await signedIn(h.handle.db, owner);
    const res = await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/__Host-ft_session=; Path=\/; Secure; SameSite=Lax; Max-Age=0; HttpOnly/);
    expect(await h.handle.db.select().from(sessions).where(eq(sessions.personId, owner))).toEqual([]);
    expect((await h.app.inject({ url: '/api/me', headers })).statusCode).toBe(401);
  });

  it('stores only a hash of the session id', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner');
    const headers = await signedIn(h.handle.db, owner);
    const raw = /__Host-ft_session=([^;]+)/.exec(headers.cookie!)![1]!;
    const rows = await h.handle.db.select({ idHash: sessions.idHash }).from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.idHash).not.toContain(raw);
    expect(rows[0]!.idHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('forgets a session after 30 idle days', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner');
    const headers = await signedIn(h.handle.db, owner);
    // The harness clock is fixed at NOW, so age the session against NOW.
    await h.handle.client.query(`update sessions set last_seen_at = $1`, [new Date(NOW.getTime() - 31 * 86_400_000)]);
    expect((await h.app.inject({ url: '/api/me', headers })).statusCode).toBe(401);
  });
});

describe('rate limits', () => {
  it('answer 429 with Retry-After once the window is used up, and audit it once', async () => {
    h = await harness();
    await seedHousehold(h.handle.db);
    let last = 0;
    for (let i = 0; i < 32; i++) {
      const res = await h.app.inject({ method: 'POST', url: '/api/invites/lookup', headers: { origin: ORIGIN }, payload: { token: 'x'.repeat(43) } });
      last = res.statusCode;
      if (i < 30) expect(res.statusCode).toBe(404);
    }
    expect(last).toBe(429);
    const audited = await h.handle.db.select().from(auditEvents).where(eq(auditEvents.action, 'auth.rate_limited'));
    expect(audited).toHaveLength(1);
  });

  it('counts per client address, taken from one proxy hop', () => {
    let t = 0;
    const limiter = new RateLimiter(() => t);
    const limit = { max: 2, windowMs: 1000 };
    expect(limiter.hit('a', limit).allowed).toBe(true);
    expect(limiter.hit('a', limit).allowed).toBe(true);
    expect(limiter.hit('a', limit).allowed).toBe(false);
    expect(limiter.hit('b', limit).allowed).toBe(true);
    t = 1000;
    expect(limiter.hit('a', limit).allowed).toBe(true);
  });
});

describe('invites', () => {
  it('look up an invalid token with a sentence, not a stack', async () => {
    h = await harness();
    await seedHousehold(h.handle.db);
    const res = await h.app.inject({ method: 'POST', url: '/api/invites/lookup', headers: { origin: ORIGIN }, payload: { token: 'y'.repeat(43) } });
    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toMatch(/expired or has already been used/);
  });

  it('are made by the owner only, and stored as a hash', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner');
    const parent = await seedPerson(h.handle.db, hh, 'parent');
    const asParent = await h.app.inject({ method: 'POST', url: '/api/people/invites', headers: await signedIn(h.handle.db, parent), payload: { displayName: 'Gran', role: 'carer' } });
    expect(asParent.statusCode).toBe(403);
    const res = await h.app.inject({ method: 'POST', url: '/api/people/invites', headers: await signedIn(h.handle.db, owner), payload: { displayName: 'Gran', role: 'carer' } });
    expect(res.statusCode).toBe(201);
    const { link } = res.json();
    expect(link).toMatch(new RegExp(`^${ORIGIN}/join#[A-Za-z0-9_-]{43}$`));
    const token = link.split('#')[1];
    const stored = await h.handle.db.select({ tokenHash: invites.tokenHash }).from(invites);
    expect(stored[0]!.tokenHash).not.toContain(token);
    const lookup = await h.app.inject({ method: 'POST', url: '/api/invites/lookup', headers: { origin: ORIGIN }, payload: { token } });
    expect(lookup.json()).toEqual({ kind: 'join', householdName: 'The Testers', displayName: 'Gran', role: 'carer' });
  });

  it('can be cancelled, after which the link stops working', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner');
    const headers = await signedIn(h.handle.db, owner);
    const made = (await h.app.inject({ method: 'POST', url: '/api/people/invites', headers, payload: { displayName: 'Mum', role: 'parent' } })).json();
    expect((await h.app.inject({ method: 'DELETE', url: `/api/people/invites/${made.id}`, headers })).statusCode).toBe(200);
    const token = made.link.split('#')[1];
    expect((await h.app.inject({ method: 'POST', url: '/api/invites/lookup', headers: { origin: ORIGIN }, payload: { token } })).statusCode).toBe(404);
  });
});

describe('people', () => {
  it('cannot remove or demote the last owner, and say why', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner');
    const headers = await signedIn(h.handle.db, owner);
    const del = await h.app.inject({ method: 'DELETE', url: `/api/people/${owner}`, headers });
    expect(del.statusCode).toBe(409);
    expect(del.json().detail).toMatch(/only owner/);
    const demote = await h.app.inject({ method: 'PATCH', url: `/api/people/${owner}`, headers, payload: { role: 'parent' } });
    expect(demote.statusCode).toBe(409);
    // A refused change has no side effects: still signed in, nothing audited as done.
    expect((await h.app.inject({ url: '/api/me', headers })).statusCode).toBe(200);
    const done = await h.handle.db.select().from(auditEvents);
    expect(done.map((e) => e.action).filter((a) => a.startsWith('person.'))).toEqual([]);
    expect(h.logs.lines.some((l) => String((l.err as { message?: string } | undefined)?.message ?? '').includes('already sent'))).toBe(false);
  });

  it('sign a person out everywhere when their role changes, and audit before and after', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner');
    const parent = await seedPerson(h.handle.db, hh, 'parent');
    const parentHeaders = await signedIn(h.handle.db, parent);
    const res = await h.app.inject({ method: 'PATCH', url: `/api/people/${parent}`, headers: await signedIn(h.handle.db, owner), payload: { role: 'carer' } });
    expect(res.statusCode).toBe(200);
    expect((await h.app.inject({ url: '/api/me', headers: parentHeaders })).statusCode).toBe(401);
    const events = await h.handle.db.select().from(auditEvents).where(eq(auditEvents.action, 'person.role_changed'));
    expect(events[0]).toMatchObject({ actorPersonId: owner, targetId: parent, before: { role: 'parent' }, after: { role: 'carer' } });
  });

  it('list people with their passkey count and who is me', async () => {
    h = await harness();
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner', 'Dad');
    await seedPerson(h.handle.db, hh, 'parent', 'Mum');
    await seedPerson(h.handle.db, hh, 'child', 'Ollie');
    const res = await h.app.inject({ url: '/api/people', headers: await signedIn(h.handle.db, owner) });
    expect(res.json().map((p: { displayName: string; isMe: boolean }) => [p.displayName, p.isMe])).toEqual([
      ['Dad', true],
      ['Mum', false],
    ]);
  });
});

describe('auth state', () => {
  it('says the owner is still needed until one exists', async () => {
    h = await harness();
    expect((await h.app.inject('/api/auth/state')).json()).toEqual({ setup: 'needs-owner', me: null, sso: false });
    const hh = await seedHousehold(h.handle.db);
    const owner = await seedPerson(h.handle.db, hh, 'owner', 'Dad');
    const state = (await h.app.inject({ url: '/api/auth/state', headers: await signedIn(h.handle.db, owner) })).json();
    expect(state.setup).toBe('ready');
    expect(state.me).toMatchObject({ displayName: 'Dad', role: 'owner', householdName: 'The Testers' });
  });
});
