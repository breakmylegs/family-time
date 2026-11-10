import { maintenance, type Db } from '@family-time/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../audit.js';
import { HEALTH_PATHS } from '../logging.js';
import { theHousehold, webOrigin } from '../settings.js';
import { can, type Capability } from './capabilities.js';
import { CSRF_COOKIE, CSRF_HEADER, parseCookies, SESSION_COOKIE } from './cookies.js';
import { RateLimiter, type RateLimit } from './ratelimit.js';
import { findSession, type AuthContext } from './sessions.js';
import { sameToken } from './tokens.js';

/**
 * Who may call a route:
 * - `public`: anyone. Health checks, sign-in, invite redemption.
 * - `session`: any signed-in person.
 * - `token`: no session and no cookies; the route checks its own bearer token or OAuth grant (MCP).
 * - a capability: a signed-in person whose role has it.
 */
export type Access = 'public' | 'session' | 'token' | Capability;

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
    rateLimit?: RateLimit;
  }
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/**
 * Still work in maintenance mode: signing in and out, and Control. A parent can always Allow, Block,
 * Pause, Resume or go back to Normal, because that is what keeps a child's evening right.
 */
const MAINTENANCE_EXEMPT = new Set([
  '/api/auth/login/options',
  '/api/auth/login/verify',
  '/api/auth/logout',
  '/api/auth/oidc/unlink',
  '/api/children/:id/overrides',
  '/api/children/:id/overrides/:overrideId/end',
  '/api/children/:id/normal',
  '/api/children/:id/normal/undo',
  '/api/children/:id/resume',
  '/api/children/:id/resume/undo',
]);
export const MAINTENANCE_DETAIL = 'Family time is being worked on, so this change waits until it is done. Allow, Block and Pause on Control still work.';

export interface AccessDeps {
  db: Db;
  now: () => Date;
  limiter?: RateLimiter;
}

/**
 * Default deny. Every route must declare `config.access`, or the server refuses to start, so a
 * route added in a later phase cannot be open by accident. Runs in onRequest, before the body is
 * parsed, so a refused request costs nothing and a rate limit cannot be skipped by a body error.
 */
export function registerAccess(app: FastifyInstance, deps: AccessDeps): void {
  const limiter = deps.limiter ?? new RateLimiter();

  app.addHook('onRoute', (route) => {
    if (!route.config?.access) {
      const methods = Array.isArray(route.method) ? route.method.join(',') : route.method;
      throw new Error(`Route ${methods} ${route.url} has no access rule. Add config: { access: ... }`);
    }
  });

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = request.routeOptions.config;
    const access = config?.access;
    if (!access) return; // not-found handler: no route, nothing to protect
    if (HEALTH_PATHS.has(request.routeOptions.url ?? '')) return;

    if (config.rateLimit) {
      const decision = limiter.hit(`${request.routeOptions.url}|${request.ip}`, config.rateLimit);
      if (!decision.allowed) {
        if (decision.firstRefusal) {
          request.log.warn({ event: 'rate_limited', path: request.routeOptions.url, ip: request.ip, socket: request.socket.remoteAddress });
          await audit(deps.db, { actor: { label: 'rate-limit' }, action: 'auth.rate_limited', targetType: 'route', targetId: request.routeOptions.url ?? '', ip: request.ip }, request.log);
        }
        return reply.code(429).header('retry-after', String(decision.retryAfterSeconds)).send({ error: 'too_many_requests' });
      }
    }

    // Maintenance mode (ADR 0017): reading works, changing waits.
    if (!SAFE_METHODS.has(request.method) && !MAINTENANCE_EXEMPT.has(request.routeOptions.url ?? '')) {
      const householdId = request.auth?.person.householdId ?? (await theHousehold(deps.db))?.id;
      const m = householdId ? await maintenance(deps.db, householdId) : null;
      if (m?.on) return reply.code(503).send({ error: 'maintenance', detail: m.message ? `${m.message.replace(/[.!?]?$/, '.')} This change waits until then. Allow, Block and Pause on Control still work.` : MAINTENANCE_DETAIL });
    }

    // Bearer routes never read cookies, so a session cookie can never ride along on them, and they
    // are called by apps, not pages, so there is no Origin to check.
    if (access === 'token') return;

    const cookies = parseCookies(request.headers.cookie);
    const rawSession = cookies[SESSION_COOKIE];
    if (rawSession) {
      const auth = await findSession(deps.db, rawSession, deps.now());
      if (auth) request.auth = auth;
    }

    // State-changing requests must come from our own pages: same Origin, and for signed-in
    // requests the double-submit CSRF token too. Bodyless POSTs included.
    if (!SAFE_METHODS.has(request.method)) {
      const problem = await originProblem(deps.db, request);
      if (problem) return reply.code(403).send({ error: 'forbidden', detail: problem });
      if (request.auth) {
        const header = request.headers[CSRF_HEADER];
        const cookie = cookies[CSRF_COOKIE];
        if (typeof header !== 'string' || !cookie || !sameToken(header, cookie)) {
          return reply.code(403).send({ error: 'forbidden', detail: 'Missing or wrong CSRF token. Reload the page and try again.' });
        }
      }
    }

    if (access === 'public') return;
    if (!request.auth) return reply.code(401).send({ error: 'signed_out' });
    if (access === 'session') return;
    if (!can(request.auth.person.role, access)) return reply.code(403).send({ error: 'forbidden', detail: `Needs ${access}` });
  });
}

/** Undefined when the request's Origin header matches the stored public origin. */
async function originProblem(db: Db, request: FastifyRequest): Promise<string | undefined> {
  const origin = request.headers.origin;
  if (!origin) return 'Missing Origin header.';
  const householdId = request.auth?.person.householdId ?? (await theHousehold(db))?.id;
  const expected = householdId ? await webOrigin(db, householdId) : undefined;
  if (!expected) return undefined; // nothing set up yet: no session can exist, and passkeys refuse anyway
  return origin === expected.origin ? undefined : `Origin ${origin} is not ${expected.origin}.`;
}
