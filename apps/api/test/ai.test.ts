// AI and MCP through the api (Phase 7 exit criteria 1 to 3): every feature off says so and falls
// back; switched on, it runs against a mock model and only ever makes cards; and an MCP client
// signs in with OAuth (consent, PKCE, a client metadata document), reads status, proposes an
// Allow, and nothing happens until a parent taps Approve.
import { createHash, randomBytes } from 'node:crypto';
import { answeringModel } from '@family-time/ai/testing';
import { aiCalls, aiKeys, auditEvents, overrides, proposals, services, type Db } from '@family-time/db';
import { ApprovalItem, ChildStatus } from '@family-time/schemas';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, seedHousehold, seedPerson, signedIn } from './accounts.js';
import { privateAddress } from '../src/mcp/oauth.js';
import { harness, type Harness } from './helpers.js';

// Monday 26 October 2026, 16:00 London: free time on a school night.
const FREE = new Date('2026-10-26T16:00:00Z');
const CLIENT_ID = 'https://assistant.example/oauth/client.json';
const REDIRECT = 'http://localhost:33418/callback';

let h: Harness | undefined;
beforeEach(() => {
  process.env['MASTER_KEY'] = 'ab'.repeat(32);
});
afterEach(async () => {
  await h?.close();
  h = undefined;
  delete process.env['MASTER_KEY'];
});

async function seed(db: Db) {
  const hh = await seedHousehold(db);
  const mum = await seedPerson(db, hh, 'owner', 'Mum');
  const dad = await seedPerson(db, hh, 'parent', 'Dad');
  const gran = await seedPerson(db, hh, 'carer', 'Gran');
  const ollie = await seedPerson(db, hh, 'child', 'Ollie');
  const [youtube] = await db.insert(services).values({ householdId: hh, name: 'YouTube', source: 'adguard', adguardId: 'youtube', domains: ['youtube.com'] }).returning();
  return { hh, mum, dad, gran, ollie, youtube: youtube!, headers: { mum: await signedIn(db, mum), dad: await signedIn(db, dad), gran: await signedIn(db, gran) } };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

const feature = (over: Record<string, unknown> = {}) => ({ on: true, provider: 'anthropic', model: 'claude-haiku-5-5', monthlyCapPence: 100, levelTwo: true, ...over });

/** The owner pastes a key and switches everything on. */
async function switchOn(app: FastifyInstance, s: Seeded, over: { control?: Record<string, unknown>; mcp?: boolean } = {}) {
  const key = await app.inject({ method: 'PUT', url: '/api/ai/keys/anthropic', headers: s.headers.mum, payload: { key: 'fake-test-key-secret-value-WXYZ' } });
  expect(key.statusCode).toBe(200);
  const res = await app.inject({
    method: 'PUT',
    url: '/api/ai',
    headers: s.headers.mum,
    payload: { on: true, features: { control: feature(over.control), suggestions: feature({ levelTwo: false }), summary: feature({ levelTwo: false }) }, mcp: { on: over.mcp ?? true } },
  });
  expect(res.statusCode).toBe(200);
}

const ALLOW_YOUTUBE = JSON.stringify({ action: 'allow', child: 'Child A', target: 'YouTube', duration: '1h', why: 'Child A gets an hour.' });

describe('with AI off', () => {
  it('answers every feature with its fallback, and MCP only says it is off', async () => {
    delete process.env['MASTER_KEY'];
    h = await harness({ now: FREE, aiModel: async () => answeringModel(ALLOW_YOUTUBE) });
    const s = await seed(h.handle.db);
    const view = (await h.app.inject({ url: '/api/ai', headers: s.headers.mum })).json();
    expect(view).toMatchObject({ available: false, on: false, mcp: { on: false } });
    const on = await h.app.inject({ method: 'PUT', url: '/api/ai', headers: s.headers.mum, payload: { on: true, features: {}, mcp: { on: false } } });
    expect(on.statusCode).toBe(409);

    const control = (await h.app.inject({ method: 'POST', url: '/api/ai/control', headers: s.headers.dad, payload: { text: 'Let Ollie have YouTube for an hour' } })).json();
    expect(control).toEqual({ ok: false, message: 'AI is switched off. The owner can switch it on in Settings.', fallback: 'Use Allow, Block and Pause on Control as usual.' });
    const ideas = (await h.app.inject({ url: '/api/ai/job-ideas', headers: s.headers.dad })).json();
    expect(ideas).toMatchObject({ fromAi: false, ideas: expect.arrayContaining([expect.objectContaining({ title: 'Set the table' })]) });
    const note = (await h.app.inject({ url: `/api/children/${s.ollie}/week-note`, headers: s.headers.dad })).json();
    expect(note).toMatchObject({ fromAi: false, text: expect.stringMatching(/^Ollie used/) });

    expect((await h.app.inject({ url: '/.well-known/oauth-authorization-server' })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'POST', url: '/mcp', payload: {} })).json()).toMatchObject({ error: 'mcp_off' });
    expect(await h.handle.db.select().from(proposals)).toEqual([]);
  });
});

describe('with AI on', () => {
  it('keeps the key sealed, shows only its last four, and never writes it to the audit', async () => {
    h = await harness({ now: FREE });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    const view = (await h.app.inject({ url: '/api/ai', headers: s.headers.mum })).json();
    expect(view.providers.find((p: { id: string }) => p.id === 'anthropic').key).toMatchObject({ lastFour: 'WXYZ' });
    expect(JSON.stringify(view)).not.toContain('secret-value');
    const [k] = await h.handle.db.select().from(aiKeys);
    expect(k!.sealed).not.toContain('secret');
    expect(JSON.stringify(await h.handle.db.select().from(auditEvents))).not.toContain('secret-value');
    // Owner only: a parent cannot read or change AI settings.
    expect((await h.app.inject({ url: '/api/ai', headers: s.headers.dad })).statusCode).toBe(403);
  });

  it('turns words into a card, and only a parent tap makes the change', async () => {
    const model = answeringModel(ALLOW_YOUTUBE);
    h = await harness({ now: FREE, aiModel: async () => model });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);

    const res = (await h.app.inject({ method: 'POST', url: '/api/ai/control', headers: s.headers.dad, payload: { text: 'Let Ollie have YouTube for an hour' } })).json();
    expect(res).toMatchObject({ ok: true, made: [{ summary: 'Allow YouTube for Ollie for an hour' }] });
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain('Ollie');
    expect(await h.handle.db.select().from(overrides)).toEqual([]);

    const list = ApprovalItem.array().parse((await h.app.inject({ url: '/api/approvals', headers: s.headers.dad })).json());
    expect(list[0]).toMatchObject({ kind: 'proposal', title: 'Allow YouTube for Ollie for an hour', from: 'Suggested by AI', asked: 'Let Ollie have YouTube for an hour', needs: 'parent' });
    expect((await h.app.inject({ url: '/api/approvals/count', headers: s.headers.gran })).json()).toEqual({ waiting: 1 });

    const id = res.made[0].id;
    expect((await h.app.inject({ method: 'POST', url: `/api/proposals/${id}/approve`, headers: s.headers.gran })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'POST', url: `/api/proposals/${id}/approve`, headers: s.headers.dad })).statusCode).toBe(200);
    const status = ChildStatus.parse((await h.app.inject({ url: `/api/children/${s.ollie}/status`, headers: s.headers.dad })).json());
    expect(status.services[0]).toMatchObject({ name: 'YouTube', state: 'allowed', reason: 'Dad allowed it.' });
    expect((await h.app.inject({ method: 'POST', url: `/api/proposals/${id}/approve`, headers: s.headers.dad })).statusCode).toBe(404);

    const calls = await h.handle.db.select().from(aiCalls);
    expect(calls).toEqual([expect.objectContaining({ feature: 'control', outcome: 'ok', inputTokens: 100, outputTokens: 20, level: 2 })]);
  });

  it("stops at the month's limit and says so", async () => {
    h = await harness({ now: FREE, aiModel: async () => answeringModel(ALLOW_YOUTUBE) });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s, { control: { monthlyCapPence: 0 } });
    const res = (await h.app.inject({ method: 'POST', url: '/api/ai/control', headers: s.headers.dad, payload: { text: 'YouTube for an hour' } })).json();
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/spending limit/) });
    expect((await h.handle.db.select().from(aiCalls))[0]).toMatchObject({ outcome: 'cap_reached' });
  });

  it('suggests jobs with the weather as quoted data, and writes the week note with the name put back', async () => {
    const ideas = answeringModel(JSON.stringify({ ideas: [{ title: 'Tidy the shoe rack', picture: 'star', rewardType: 'money', amount: 20 }] }));
    const note = answeringModel('Child A had a steady week.');
    h = await harness({ now: FREE, aiModel: async () => ideas, readWeather: async () => 'Rain all day' });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    await h.app.inject({ method: 'POST', url: '/api/mcp/servers', headers: s.headers.mum, payload: { name: 'Weather', url: 'https://weather.example/mcp', approved: true, tools: [{ name: 'forecast', arguments: { place: 'Leeds' } }] } });
    expect((await h.app.inject({ url: '/api/ai/job-ideas', headers: s.headers.dad })).json()).toEqual({ ideas: [{ title: 'Tidy the shoe rack', picture: 'star', rewardType: 'money', amount: 20 }], fromAi: true, message: null });
    expect(JSON.stringify(ideas.doGenerateCalls)).toContain('<data name=\\"weather\\">');

    await h.close();
    h = await harness({ now: FREE, aiModel: async () => note });
    const t = await seed(h.handle.db);
    await switchOn(h.app, t);
    expect((await h.app.inject({ url: `/api/children/${t.ollie}/week-note`, headers: t.headers.dad })).json()).toEqual({ text: 'Ollie had a steady week.', fromAi: true });
  });
});

// ---- MCP, end to end through the real routes

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/** Sends the MCP client's requests into the app, as if over the network. */
function fetchInto(app: FastifyInstance, tamper?: (headers: Headers) => void) {
  return async (input: string | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    tamper?.(req.headers);
    const url = new URL(req.url);
    const body = req.method === 'GET' ? undefined : Buffer.from(await req.arrayBuffer());
    const res = await app.inject({ method: req.method as 'POST', url: url.pathname + url.search, headers: Object.fromEntries(req.headers), ...(body ? { payload: body } : {}) });
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, String(v));
    return new Response([204, 202].includes(res.statusCode) ? null : res.rawPayload, { status: res.statusCode, headers });
  };
}

async function signIn(app: FastifyInstance, headers: Record<string, string>, scope = 'read propose') {
  const { verifier, challenge } = pkce();
  const query = { response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope, state: 'xyz', resource: `${ORIGIN}/mcp` };
  const consent = await app.inject({ url: `/api/oauth/consent?${new URLSearchParams(query)}`, headers });
  const done = await app.inject({ method: 'POST', url: '/api/oauth/consent', headers, payload: { query, approve: true } });
  if (done.statusCode !== 200) return { consent: consent.json(), done: done.json(), tokens: null, verifier };
  const back = new URL(done.json().redirect);
  const form = { grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier };
  const token = await app.inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(form).toString() });
  return { consent: consent.json(), done: done.json(), back, form, tokens: token.json(), verifier };
}

async function connect(app: FastifyInstance, accessToken: string, confirm = true, tamper?: (headers: Headers) => void) {
  const asked: string[] = [];
  const client = new Client({ name: 'Test Assistant', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: 'auto' } });
  client.setRequestHandler('elicitation/create', async (request) => {
    asked.push(String(request.params.message));
    return { action: 'accept', content: { confirm } };
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { authProvider: { token: async () => accessToken }, fetch: fetchInto(app, tamper) }));
  return { client, asked };
}

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? '');

describe('MCP', () => {
  const metadata = async (url: string) => ({ client_id: url, client_name: 'Test Assistant', redirect_uris: [REDIRECT] });

  it('signs in with OAuth, reads status, proposes an Allow, and only a parent tap carries it out', async () => {
    h = await harness({ now: FREE, fetchClientMetadata: metadata });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);

    const meta = (await h.app.inject({ url: '/.well-known/oauth-authorization-server' })).json();
    expect(meta).toMatchObject({ issuer: ORIGIN, code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true });
    const unauth = await h.app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.headers['www-authenticate']).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);

    // The owner signs in from the assistant: the consent screen names the app; allowing it lets it in.
    const { consent, back, tokens } = await signIn(h.app, s.headers.mum);
    expect(consent).toEqual({ client: { name: 'Test Assistant', uri: CLIENT_ID, host: 'assistant.example' }, scopes: ['read', 'propose'], allowed: false, canAllow: true });
    expect(back!.searchParams.get('state')).toBe('xyz');
    expect(back!.searchParams.get('iss')).toBe(ORIGIN);
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read propose' });

    const { client, asked } = await connect(h.app, tokens.access_token);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_history', 'get_pending_approvals', 'get_status', 'get_week', 'propose_approval', 'propose_override', 'propose_pause']);
    expect(textOf(await client.callTool({ name: 'get_status', arguments: { child: 'Ollie' } }))).toMatch(/YouTube: blocked/);

    const proposed = await client.callTool({ name: 'propose_override', arguments: { child: 'ollie', app: 'youtube', action: 'allow', duration: '1h' } });
    expect(asked).toEqual(['Send a card to Approvals: Allow YouTube for Ollie for an hour?']);
    expect(textOf(proposed)).toMatch(/^Sent to Approvals: Allow YouTube for Ollie for an hour\./);
    expect(await h.handle.db.select().from(overrides)).toEqual([]);

    const [card] = ApprovalItem.array().parse((await h.app.inject({ url: '/api/approvals', headers: s.headers.dad })).json());
    expect(card).toMatchObject({ kind: 'proposal', from: 'Suggested by Test Assistant', title: 'Allow YouTube for Ollie for an hour' });
    expect((await h.app.inject({ method: 'POST', url: `/api/proposals/${card!.id}/approve`, headers: s.headers.dad })).statusCode).toBe(200);
    expect(textOf(await client.callTool({ name: 'get_status', arguments: { child: 'Ollie' } }))).toMatch(/YouTube: allowed\. Dad allowed it\./);
    await client.close();

    const audited = (await h.handle.db.select().from(auditEvents)).map((e) => e.action);
    expect(audited).toEqual(expect.arrayContaining(['mcp.client.allowed', 'mcp.consent.given', 'mcp.tool', 'proposal.made', 'proposal.approved', 'control.allow']));
  });

  it('makes no card when the person says no at the confirmation', async () => {
    h = await harness({ now: FREE, fetchClientMetadata: metadata });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    const { tokens } = await signIn(h.app, s.headers.mum);
    const { client } = await connect(h.app, tokens.access_token, false);
    expect(textOf(await client.callTool({ name: 'propose_pause', arguments: { child: 'Ollie', duration: '30m' } }))).toBe('Not sent. Nothing has changed.');
    expect(await h.handle.db.select().from(proposals)).toEqual([]);
    await client.close();
  });

  it('gives read-only sign-ins no propose tools, and needs the owner to let an app in', async () => {
    h = await harness({ now: FREE, fetchClientMetadata: metadata });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    // Dad is a parent, not the owner: a new app needs the owner first.
    const dad = await signIn(h.app, s.headers.dad, 'read');
    expect(dad.consent).toMatchObject({ allowed: false, canAllow: false });
    expect(dad.done).toMatchObject({ error: 'needs_owner' });
    // Gran is a carer: she cannot connect apps at all.
    expect((await h.app.inject({ url: `/api/oauth/consent?response_type=code`, headers: s.headers.gran })).statusCode).toBe(403);

    await signIn(h.app, s.headers.mum, 'read');
    const { tokens } = await signIn(h.app, s.headers.dad, 'read');
    const { client } = await connect(h.app, tokens.access_token);
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain('propose_override');
    await client.close();
  });

  it('refuses a wrong verifier and a reused code, and ends the sign-in when a refresh token is reused', async () => {
    h = await harness({ now: FREE, fetchClientMetadata: metadata });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    const form = (f: Record<string, string>) => ({ method: 'POST' as const, url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(f).toString() });

    const first = await signIn(h.app, s.headers.mum);
    expect((await h.app.inject(form(first.form!))).json()).toMatchObject({ error: 'invalid_grant' });

    const { verifier, challenge } = pkce();
    const query = { response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope: 'read' };
    const done = (await h.app.inject({ method: 'POST', url: '/api/oauth/consent', headers: s.headers.mum, payload: { query, approve: true } })).json();
    const code = new URL(done.redirect).searchParams.get('code')!;
    const wrong = await h.app.inject(form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: pkce().verifier }));
    expect(wrong.json()).toMatchObject({ error: 'invalid_grant', error_description: 'The code_verifier does not match.' });
    expect(verifier).not.toBe('');

    const old = first.tokens.refresh_token;
    const next = (await h.app.inject(form({ grant_type: 'refresh_token', refresh_token: old, client_id: CLIENT_ID }))).json();
    expect(next).toMatchObject({ token_type: 'Bearer' });
    expect(next.refresh_token).not.toBe(old);
    // The old one again: someone has a copy, so everything from this sign-in stops working.
    expect((await h.app.inject(form({ grant_type: 'refresh_token', refresh_token: old, client_id: CLIENT_ID }))).json()).toMatchObject({ error: 'invalid_grant' });
    const after = await h.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${next.access_token}` }, payload: {} });
    expect(after.statusCode).toBe(401);
  });

  it('stops working the moment the owner removes the app', async () => {
    h = await harness({ now: FREE, fetchClientMetadata: metadata });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    const { tokens } = await signIn(h.app, s.headers.mum);
    const [c] = (await h.app.inject({ url: '/api/mcp/clients', headers: s.headers.mum })).json();
    expect(c).toMatchObject({ name: 'Test Assistant', allowed: true, scopes: ['read', 'propose'] });
    await h.app.inject({ method: 'DELETE', url: `/api/mcp/clients/${c.id}`, headers: s.headers.mum });
    const res = await h.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${tokens.access_token}` }, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('keeps the name the owner allowed, and needs allowing again when the return address changes', async () => {
    let doc = { client_name: 'Test Assistant', redirect_uris: [REDIRECT] };
    h = await harness({ now: FREE, fetchClientMetadata: async (url) => ({ client_id: url, ...doc }) });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    await signIn(h.app, s.headers.mum);
    doc = { client_name: 'Mum', redirect_uris: [REDIRECT] };
    const again = await signIn(h.app, s.headers.dad);
    expect(again.consent).toMatchObject({ client: { name: 'Test Assistant' }, allowed: true });
    doc = { client_name: 'Test Assistant', redirect_uris: [REDIRECT, 'https://elsewhere.example/cb'] };
    expect((await signIn(h.app, s.headers.dad)).done).toMatchObject({ error: 'needs_owner' });
  });

  it('ends every sign-in when the owner switches connected apps off', async () => {
    h = await harness({ now: FREE, fetchClientMetadata: metadata });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    const { tokens } = await signIn(h.app, s.headers.mum);
    await switchOn(h.app, s, { mcp: false });
    await switchOn(h.app, s, { mcp: true });
    const res = await h.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${tokens.access_token}` }, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('never fetches an app document from the home network', () => {
    for (const ip of ['10.0.0.1', '192.168.1.20', '127.0.0.1', '169.254.169.254', '198.18.0.1', '::1', 'fd00::1', '::ffff:192.168.1.1', '::ffff:c0a8:101', '64:ff9b::a00:1']) expect(privateAddress(ip), ip).toBe(true);
    for (const ip of ['1.1.1.1', '2606:4700:4700::1111']) expect(privateAddress(ip), ip).toBe(false);
  });

  it('refuses a call whose Mcp-Method header says something other than its body', async () => {
    h = await harness({ now: FREE, fetchClientMetadata: metadata });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    const { tokens } = await signIn(h.app, s.headers.mum);
    // A proxy, or an attacker, that changes the routing header: the server checks it against the body.
    const { client } = await connect(h.app, tokens.access_token, true, (headers) => {
      if (headers.get('mcp-method') === 'tools/call') headers.set('mcp-method', 'tools/list');
    });
    await expect(client.callTool({ name: 'get_status', arguments: {} })).rejects.toThrow(/header|mismatch|-32020/i);
    await client.close();
  });

  it('refuses a return address the app did not list for itself', async () => {
    h = await harness({ now: FREE, fetchClientMetadata: metadata });
    const s = await seed(h.handle.db);
    await switchOn(h.app, s);
    const query = { response_type: 'code', client_id: CLIENT_ID, redirect_uri: 'https://evil.example/cb', code_challenge: pkce().challenge, code_challenge_method: 'S256' };
    const res = await h.app.inject({ url: `/api/oauth/consent?${new URLSearchParams(query)}`, headers: s.headers.mum });
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });
});
