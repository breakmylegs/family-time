import { randomUUID } from 'node:crypto';
import type { LanguageModel, ProviderId, WeatherServer } from '@family-time/ai';
import { people, type Db } from '@family-time/db';
import { isNotNull } from 'drizzle-orm';
import { postgresLedger, type LedgerPort } from '@family-time/ledger';
import type { Liveness, Version } from '@family-time/schemas';
import Fastify, { type FastifyInstance } from 'fastify';
import type { BuildInfo } from './build.js';
import { registerAccess } from './auth/access.js';
import type { Oidc } from './auth/oidc.js';
import type { RateLimiter } from './auth/ratelimit.js';
import { readiness } from './health.js';
import { HEALTH_PATHS, loggerOptions, logPath } from './logging.js';
import type { FetchClientMetadata } from './mcp/oauth.js';
import { aiRoutes } from './routes/ai.js';
import { authRoutes } from './routes/auth.js';
import { Changes, eventRoutes } from './events.js';
import { controlRoutes, type QueryLogEntry } from './routes/control.js';
import { economyRoutes } from './routes/economy.js';
import { familyRoutes } from './routes/family.js';
import { kioskRoutes } from './routes/kiosk.js';
import { oidcRoutes, ownerSso } from './routes/oidc.js';
import { setupRoutes } from './routes/setup.js';
import { mcpRoutes } from './routes/mcp.js';
import { peopleRoutes } from './routes/people.js';
import { pushRoutes } from './routes/push.js';
import { systemRoutes } from './routes/system.js';
import { registerStatic } from './static.js';

export interface ServerDeps {
  db: Db;
  build: BuildInfo;
  now?: () => Date;
  logLevel?: string;
  logStream?: NodeJS.WritableStream;
  /** Proxies in front of the api. Caddy is one. */
  trustedProxyHops?: number;
  /** The parent app's build, served at /. Absent in api-only tests. */
  staticDir?: string;
  /** Injected so tests can share or inspect it. */
  limiter?: RateLimiter;
  /** Wakes the reconciler after a change. A no-op in tests that do not care. */
  notifyChange?: () => Promise<void>;
  /** Read-only access to AdGuard's query log, for the discovery helper. */
  readQuerylog?: (limit: number) => Promise<QueryLogEntry[]>;
  /** Live updates for open Control screens. The production entry feeds it from Postgres NOTIFY. */
  changes?: Changes;
  /** The VAPID public key, when init.sh has made one. */
  vapidPublicKey?: string;
  /** The ledger. The Postgres one unless a test or the Besu adapter says otherwise. */
  ledger?: LedgerPort;
  ledgerAdapter?: 'postgres' | 'besu';
  /** For readiness: asks AdGuard's admin API anything. */
  pingAdguard?: () => Promise<void>;
  /** Owner sign-in through Authentik, when secrets/oidc_client_secret holds the client secret. */
  oidc?: Oidc;
  /** The kiosk's address on the LAN, shown with a pairing code. */
  kioskUrl?: string;
  /** Tests: a mock model instead of a provider, a fake forecast, a client document without fetching. */
  aiModel?: (provider: ProviderId, name: string) => Promise<LanguageModel>;
  readWeather?: (server: WeatherServer) => Promise<string | null>;
  fetchClientMetadata?: FetchClientMetadata;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const now = deps.now ?? (() => new Date());
  const hops = deps.trustedProxyHops ?? 1;

  const app = Fastify({
    logger: loggerOptions('api', deps.logLevel ?? 'info', deps.logStream),
    disableRequestLogging: true,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    // A function of the hop count, never `true` (trusts whatever the client writes) and never a
    // number (silently ignored on Fastify 5.12).
    trustProxy: (_address: string, hop: number) => hop < hops,
    bodyLimit: 64 * 1024,
  });

  // JSON bodies only. A cross-site form post (text/plain, urlencoded, multipart) gets 415 before
  // it reaches a route, so it can never ride on a session cookie.
  app.removeContentTypeParser('text/plain');

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
  });

  app.addHook('onResponse', async (request, reply) => {
    const path = logPath(request.url);
    const fields = { event: 'request', method: request.method, path, status: reply.statusCode, ms: Math.round(reply.elapsedTime) };
    if (HEALTH_PATHS.has(path)) request.log.debug(fields);
    else if (reply.statusCode >= 500) request.log.error(fields);
    else request.log.info(fields);
  });

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: 'not_found' }));
  app.setErrorHandler(async (error: { statusCode?: number; message?: string }, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) request.log.error({ event: 'unhandled_error', err: error });
    return reply.code(status).send({ error: status === 500 ? 'internal' : error.message });
  });

  // Default deny: from here on, a route without an access rule stops the server starting.
  registerAccess(app, { db: deps.db, now, ...(deps.limiter ? { limiter: deps.limiter } : {}) });

  // Health routes: public, never rate-limited, and the access hook skips them entirely, so
  // /healthz touches nothing even when a browser sends a session cookie.
  const health = { config: { access: 'public' as const } };
  app.get('/healthz', health, async (): Promise<Liveness> => ({ status: 'ok' }));

  // Which checks fail (AdGuard down means blocking is off) is for the server itself: the container's
  // health check and verify.sh ask from inside. Anyone else, through Caddy, gets the status only.
  app.get('/readyz', health, async (request, reply) => {
    const result = await readiness({ db: deps.db, build: deps.build, now, ...(deps.pingAdguard ? { pingAdguard: deps.pingAdguard } : {}), ...(deps.ledgerAdapter ? { ledgerAdapter: deps.ledgerAdapter } : {}) });
    const inside = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '');
    return reply.code(result.status === 'ready' ? 200 : 503).send(inside ? result : { status: result.status });
  });

  app.get('/version', health, async (): Promise<Version> => {
    const { app: name, commit, builtAt, schema } = deps.build;
    return { app: name, commit, builtAt, schema };
  });

  await authRoutes(app, {
    db: deps.db,
    now,
    ssoOffered: async () => Boolean((await ownerSso(deps.db, deps.oidc)) && (await deps.db.select({ id: people.id }).from(people).where(isNotNull(people.oidcSubject)).limit(1)).length),
  });
  await oidcRoutes(app, { db: deps.db, now, ...(deps.oidc ? { oidc: deps.oidc } : {}) });
  await peopleRoutes(app, { db: deps.db, now });
  const changes = deps.changes ?? new Changes();
  await controlRoutes(app, {
    db: deps.db,
    now,
    notifyChange: deps.notifyChange ?? (async () => undefined),
    changes,
    ...(deps.readQuerylog ? { readQuerylog: deps.readQuerylog } : {}),
  });
  await eventRoutes(app, { db: deps.db, now, changes });
  const ledger = deps.ledger ?? postgresLedger(deps.db);
  await economyRoutes(app, {
    db: deps.db,
    ledger,
    now,
    changes,
    notifyChange: deps.notifyChange ?? (async () => undefined),
    ...(deps.ledgerAdapter ? { ledgerAdapter: deps.ledgerAdapter } : {}),
  });
  await kioskRoutes(app, { db: deps.db, now, ...(deps.kioskUrl ? { kioskUrl: deps.kioskUrl } : {}) });
  await familyRoutes(app, { db: deps.db, now, changes, notifyChange: deps.notifyChange ?? (async () => undefined) });
  await setupRoutes(app, { db: deps.db, now, changes, notifyChange: deps.notifyChange ?? (async () => undefined) });
  await aiRoutes(app, {
    db: deps.db,
    ledger,
    now,
    changes,
    notifyChange: deps.notifyChange ?? (async () => undefined),
    ...(deps.aiModel ? { model: deps.aiModel } : {}),
    ...(deps.readWeather ? { readWeather: deps.readWeather } : {}),
  });
  await mcpRoutes(app, { db: deps.db, ledger, now, changes, version: deps.build.commit, ...(deps.fetchClientMetadata ? { fetchClientMetadata: deps.fetchClientMetadata } : {}) });
  await systemRoutes(app, { db: deps.db, build: deps.build, now, ledgerAdapter: deps.ledgerAdapter ?? 'postgres', adguardSetUp: Boolean(deps.readQuerylog) });
  await pushRoutes(app, { db: deps.db, now, ...(deps.vapidPublicKey ? { vapidPublicKey: deps.vapidPublicKey } : {}) });
  if (deps.staticDir) registerStatic(app, deps.staticDir);

  return app;
}
