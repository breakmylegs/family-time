// The MCP endpoint and its OAuth 2.1 authorisation server (ADR 0016). Off unless the owner has
// switched MCP on and there is a master key; while off, every route here only says so.
import { oauthClients, type Db } from '@family-time/db';
import type { LedgerPort } from '@family-time/ledger';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { OAuthAuthorizeQuery, type OAuthConsent } from '@family-time/schemas';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { masterKey, mcpOn } from '../ai/store.js';
import { audit } from '../audit.js';
import { can } from '../auth/capabilities.js';
import type { Changes } from '../events.js';
import { checkClientId, exchangeCode, fetchClientMetadata, issueCode, OAuthError, parseScopes, refresh, registerClient, SCOPES, verifyAccess, type FetchClientMetadata } from '../mcp/oauth.js';
import { mcpFactory, stateKeyFrom } from '../mcp/server.js';
import { theHousehold, webOrigin } from '../settings.js';

export interface McpRouteDeps {
  db: Db;
  ledger: LedgerPort;
  now: () => Date;
  changes: Changes;
  version: string;
  /** Tests give the client's metadata document here instead of fetching it. */
  fetchClientMetadata?: FetchClientMetadata;
}

const OFF = { error: 'mcp_off', detail: 'Connecting apps is switched off. The owner can switch it on in Settings, under AI and connected apps.' };

/** A redirect_uri must be https, or http on this computer for apps that run on it. */
function redirectAllowed(uri: string) {
  const u = new URL(uri);
  return !u.hash && (u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]')));
}

export async function mcpRoutes(app: FastifyInstance, deps: McpRouteDeps): Promise<void> {
  const { db, ledger, now } = deps;
  const fetcher = deps.fetchClientMetadata ?? fetchClientMetadata;

  /** The household, its public origin, and whether MCP is on: everything here needs all three. */
  const live = async () => {
    const hh = await theHousehold(db);
    if (!hh) return null;
    const origin = await webOrigin(db, hh.id);
    if (!origin || !(await mcpOn(db, hh.id))) return null;
    return { householdId: hh.id, origin: origin.origin, resource: `${origin.origin}/mcp` };
  };

  // ---- Discovery (RFC 9728 and RFC 8414)
  const resourceMetadata = async (_request: FastifyRequest, reply: FastifyReply) => {
    const l = await live();
    if (!l) return reply.code(404).send(OFF);
    return { resource: l.resource, authorization_servers: [l.origin], scopes_supported: SCOPES, bearer_methods_supported: ['header'], resource_name: 'Family time' };
  };
  app.get('/.well-known/oauth-protected-resource', { config: { access: 'public' } }, resourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', { config: { access: 'public' } }, resourceMetadata);

  app.get('/.well-known/oauth-authorization-server', { config: { access: 'public' } }, async (_request, reply) => {
    const l = await live();
    if (!l) return reply.code(404).send(OFF);
    return {
      issuer: l.origin,
      authorization_endpoint: `${l.origin}/oauth/authorize`,
      token_endpoint: `${l.origin}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: SCOPES,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    };
  });

  // ---- Consent, in the parent app: the parent is signed in with their passkey session
  const consentFor = async (request: FastifyRequest, q: OAuthAuthorizeQuery, l: NonNullable<Awaited<ReturnType<typeof live>>>) => {
    const me = request.auth!.person;
    if (me.householdId !== l.householdId) throw new OAuthError('access_denied', 'This app is set up for a different family. Remove it from the app and connect it again from there.', 403);
    if (q.resource && q.resource !== l.resource) throw new OAuthError('invalid_target', `The app has the wrong address for Family time. Give it ${l.resource}, then try again.`);
    checkClientId(q.client_id);
    const scopes = parseScopes(q.scope);
    const client = await registerClient(db, me.householdId, q.client_id, fetcher, now());
    if (!(client.redirectUris as string[]).includes(q.redirect_uri) || !redirectAllowed(q.redirect_uri)) {
      throw new OAuthError('invalid_request', "The app's return address is not one it listed for itself, so Family time won't send you there. Try connecting again from the app. If it happens again, the app needs fixing by whoever makes it.");
    }
    return { me, client, scopes };
  };

  const oauthFail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof OAuthError) return reply.code(err.status).send({ error: err.error, detail: err.message });
    throw err;
  };

  app.get('/api/oauth/consent', { config: { access: 'control.change', rateLimit: { max: 30, windowMs: 10 * 60_000 } } }, async (request, reply) => {
    const l = await live();
    if (!l) return reply.code(404).send(OFF);
    const q = OAuthAuthorizeQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_request', detail: 'The app sent an incomplete sign-in request. Start again from the app.' });
    try {
      const { me, client, scopes } = await consentFor(request, q.data, l);
      const result: OAuthConsent = {
        client: { name: client.name, uri: client.clientUri, host: new URL(client.clientUri).host },
        scopes,
        allowed: client.allowed,
        canAllow: can(me.role, 'system.manage'),
      };
      return result;
    } catch (err) {
      return oauthFail(reply, err);
    }
  });

  const ConsentBody = z.object({ query: OAuthAuthorizeQuery, approve: z.boolean() });

  app.post('/api/oauth/consent', { config: { access: 'control.change', rateLimit: { max: 30, windowMs: 10 * 60_000 } } }, async (request, reply) => {
    const l = await live();
    if (!l) return reply.code(404).send(OFF);
    const body = ConsentBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', detail: 'The app sent an incomplete sign-in request. Start again from the app.' });
    const q = body.data.query;
    try {
      const { me, client, scopes } = await consentFor(request, q, l);
      const back = new URL(q.redirect_uri);
      if (q.state) back.searchParams.set('state', q.state);
      back.searchParams.set('iss', l.origin);
      if (!body.data.approve) {
        back.searchParams.set('error', 'access_denied');
        await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'mcp.consent.declined', targetType: 'oauth_client', targetId: client.id, ip: request.ip });
        return { redirect: back.toString() };
      }
      let granted = scopes.filter((s) => (client.scopes as string[]).includes(s));
      if (!client.allowed || granted.length < scopes.length) {
        // Only the owner lets an app in, or gives it more than it has.
        if (!can(me.role, 'system.manage')) {
          return reply.code(403).send({ error: 'needs_owner', detail: `The owner needs to allow ${client.name} first. Ask them to connect it once from their phone.` });
        }
        const merged = [...new Set([...(client.allowed ? (client.scopes as string[]) : []), ...scopes])];
        await db.update(oauthClients).set({ allowed: true, scopes: merged }).where(eq(oauthClients.id, client.id));
        await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'mcp.client.allowed', targetType: 'oauth_client', targetId: client.id, after: { name: client.name, scopes: merged }, ip: request.ip });
        granted = scopes;
      }
      const code = await issueCode(db, { clientRowId: client.id, personId: me.id, redirectUri: q.redirect_uri, challenge: q.code_challenge, scopes: granted, resource: q.resource ?? l.resource }, now());
      await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'mcp.consent.given', targetType: 'oauth_client', targetId: client.id, after: { scopes: granted }, ip: request.ip });
      back.searchParams.set('code', code);
      return { redirect: back.toString() };
    } catch (err) {
      return oauthFail(reply, err);
    }
  });

  // ---- The token endpoint: form-encoded, as OAuth requires, and only here
  await app.register(async (sub) => {
    sub.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8 * 1024 }, (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });

    sub.post('/oauth/token', { config: { access: 'token', rateLimit: { max: 30, windowMs: 10 * 60_000 } } }, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const l = await live();
      if (!l) return reply.code(404).send({ error: 'invalid_request', error_description: OFF.detail });
      const b = (request.body ?? {}) as Record<string, string | undefined>;
      try {
        if (!b['client_id']) throw new OAuthError('invalid_client', 'client_id is missing.', 401);
        if (b['grant_type'] === 'authorization_code') {
          if (!b['code'] || !b['redirect_uri'] || !b['code_verifier']) throw new OAuthError('invalid_request', 'code, redirect_uri and code_verifier are needed.');
          return await exchangeCode(db, { code: b['code'], clientId: b['client_id'], redirectUri: b['redirect_uri'], verifier: b['code_verifier'], ...(b['resource'] ? { resource: b['resource'] } : {}) }, now());
        }
        if (b['grant_type'] === 'refresh_token') {
          if (!b['refresh_token']) throw new OAuthError('invalid_request', 'refresh_token is needed.');
          return await refresh(db, { refreshToken: b['refresh_token'], clientId: b['client_id'], ...(b['scope'] ? { scope: b['scope'] } : {}) }, now());
        }
        throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
      } catch (err) {
        if (err instanceof OAuthError) return reply.code(err.status).send({ error: err.error, error_description: err.message });
        throw err;
      }
    });
  });

  // ---- The MCP endpoint: streamable HTTP, 2026-07-28 only, JSON answers
  const mk = masterKey();
  const handler = mk ? createMcpHandler(mcpFactory({ db, ledger, now, emit: (h) => deps.changes.emit(h), stateKey: stateKeyFrom(mk), version: deps.version }), { legacy: 'reject', responseMode: 'json', maxRequestBodySize: 64 * 1024 }) : null;
  app.addHook('onClose', async () => handler?.close());

  const mcp = async (request: FastifyRequest, reply: FastifyReply) => {
    const l = await live();
    if (!l || !handler) return reply.code(404).send(OFF);
    const challenge = (error?: string) =>
      reply
        .code(401)
        .header('www-authenticate', `Bearer resource_metadata="${l.origin}/.well-known/oauth-protected-resource/mcp"${error ? `, error="${error}"` : ''}, scope="${SCOPES.join(' ')}"`)
        .send({ error: error ?? 'unauthorized' });
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return challenge();
    const bearer = await verifyAccess(db, header.slice(7).trim(), now());
    if (!bearer || bearer.householdId !== l.householdId) return challenge('invalid_token');
    if (request.method !== 'POST') return reply.code(405).header('allow', 'POST').send({ error: 'method_not_allowed' });

    const headers = new Headers();
    for (const [k, v] of Object.entries(request.headers)) {
      if (v === undefined || ['content-length', 'transfer-encoding', 'connection', 'cookie'].includes(k)) continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    const web = new Request(new URL(request.url, l.origin), { method: 'POST', headers, body: JSON.stringify(request.body ?? null) });
    const res = await handler.fetch(web, {
      parsedBody: request.body,
      authInfo: {
        token: 'redacted',
        clientId: bearer.clientRowId,
        scopes: bearer.scopes,
        expiresAt: Math.floor(bearer.expiresAt.getTime() / 1000),
        resource: new URL(l.resource),
        extra: { bearer, personId: bearer.personId },
      },
    });
    reply.code(res.status);
    res.headers.forEach((value, key) => {
      if (key !== 'content-length') reply.header(key, value);
    });
    return reply.send(Buffer.from(await res.arrayBuffer()));
  };
  app.route({ method: ['GET', 'POST', 'DELETE'], url: '/mcp', config: { access: 'token', rateLimit: { max: 300, windowMs: 60_000 } }, handler: mcp });
}
