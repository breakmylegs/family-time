// The kiosk's own server (ADR 0015): a second Fastify instance in the api's process, listening on
// its own port, which Compose publishes on the server's LAN address only. Kiosk routes exist only
// here and parent routes only on the main server, so neither can be reached through the other.
//
// Every /api route needs a kiosk's bearer token, except pairing. Tokens are long-lived and
// revocable; there are no cookies here, so nothing a web page elsewhere could ride on.
import { randomUUID } from 'node:crypto';
import { maintenance, type Db } from '@family-time/db';
import type { LedgerPort } from '@family-time/ledger';
import { KioskAskRequest, KioskDoneRequest, KioskIdeaRequest, KioskPairRequest, KioskPlanRequest, KioskReflectionRequest } from '@family-time/schemas';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RateLimiter } from '../auth/ratelimit.js';
import { EconomyError, askRequest, planSession } from '../economy/commands.js';
import type { Changes } from '../events.js';
import { loggerOptions, logPath } from '../logging.js';
import { registerStatic } from '../static.js';
import { addIdea, kioskChild, kioskDone, kioskFromToken, kioskHome, kioskMe, KioskError, kioskSlots, kioskTargets, MAX_OPEN_REQUESTS, openRequests, pairKiosk, saveReflection } from './commands.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** On the kiosk server: `public` (pairing, the app's files) or `device` (a paired kiosk). */
    kiosk?: 'public' | 'device';
  }
  interface FastifyRequest {
    kiosk?: { deviceId: string; householdId: string };
  }
}

/** A phone alert for parents: a job to approve, or a request. */
export type QueueAlert = (job: { kind: 'completion' | 'request'; id: string }) => Promise<void>;

export interface KioskServerDeps {
  db: Db;
  ledger: LedgerPort;
  now?: () => Date;
  logLevel?: string;
  logStream?: NodeJS.WritableStream;
  staticDir?: string;
  queueAlert?: QueueAlert;
  /** Wakes the reconciler: a planned session is a grant AdGuard must honour. */
  notifyChange?: () => Promise<void>;
  /** Tells the parents' open screens (Approvals) that something changed. */
  changes?: Changes;
  limiter?: RateLimiter;
  /** Host headers this listener answers to (`192.168.1.10:8180`), against DNS rebinding. Unset: any. */
  allowedHosts?: string[];
}

const Child = z.object({ child: z.uuid() });
const Job = z.object({ child: z.uuid(), task: z.uuid() });
const SlotQuery = z.object({ kind: z.enum(['service', 'group']), id: z.uuid(), minutes: z.coerce.number().pipe(z.union([z.literal(30), z.literal(60)])) });

export async function buildKioskServer(deps: KioskServerDeps): Promise<FastifyInstance> {
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? new RateLimiter();
  const app = Fastify({
    logger: loggerOptions('kiosk', deps.logLevel ?? 'info', deps.logStream),
    disableRequestLogging: true,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    // The tablet talks to this port directly on the LAN: no proxy in front, so no forwarded headers.
    trustProxy: false,
    // Small by default: only the photo route takes more (below), so a large body sent to any other
    // path, with no token, is refused before it is read.
    bodyLimit: 8 * 1024,
  });
  app.removeContentTypeParser('text/plain');

  // Every kiosk route says who may call it, or the server will not start (as the main one does).
  app.addHook('onRoute', (route) => {
    if (!route.config?.kiosk && !route.config?.access) throw new Error(`Kiosk route ${String(route.method)} ${route.url} has no access rule.`);
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    // Only its own scripts and styles, and talking only to itself: an injected script, or a page
    // rewritten on the Wi-Fi, cannot load more or reach Fully Kiosk's interface from elsewhere.
    reply.header('content-security-policy', "default-src 'self'; img-src 'self' blob: data:; connect-src 'self'; style-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  });
  app.addHook('onResponse', async (request, reply) => {
    const fields = { event: 'request', method: request.method, path: logPath(request.url), status: reply.statusCode, ms: Math.round(reply.elapsedTime) };
    if (reply.statusCode >= 500) request.log.error(fields);
    else request.log.debug(fields);
  });

  // Default deny for the API: a route under /api without `kiosk: 'public'` needs a paired kiosk.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (deps.allowedHosts && !deps.allowedHosts.includes(String(request.headers.host ?? ''))) return reply.code(421).send({ error: 'wrong_host' });
    const url = request.routeOptions.url;
    // Nothing to write to at an unknown path: refused before any body is read.
    if (!url && request.method !== 'GET' && request.method !== 'HEAD') return reply.code(404).send({ error: 'not_found' });
    if (!url?.startsWith('/api')) return;
    const rule = request.routeOptions.config?.kiosk;
    if (rule === 'public') {
      const d = limiter.hit(`${url}|${request.ip}`, { max: 10, windowMs: 10 * 60_000 });
      if (!d.allowed) {
        if (d.firstRefusal) request.log.warn({ event: 'rate_limited', path: url });
        return reply.code(429).header('retry-after', String(d.retryAfterSeconds)).send({ error: 'rate_limited', message: 'Too many tries. Wait 10 minutes, then try again.' });
      }
      return;
    }
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const kiosk = token ? await kioskFromToken(deps.db, token, now()) : null;
    if (!kiosk) return reply.code(401).send({ error: 'unpaired', message: 'This kiosk needs setting up again. Ask a grown-up.' });
    request.kiosk = kiosk;
    // Maintenance mode: the kiosk still shows everything, but asks the child to wait to change it.
    if (request.method !== 'GET' && (await maintenance(deps.db, kiosk.householdId)).on) {
      return reply.code(503).send({ error: 'maintenance', message: 'Family time is having a quick tidy-up. Everything still works. Tap again in a little while.' });
    }
  });

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: 'not_found' }));
  app.setErrorHandler(async (error: unknown, request, reply) => {
    if (error instanceof KioskError || error instanceof EconomyError) return reply.code(error.status).send({ error: error.code, message: error.message });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'invalid', message: error.issues[0]?.message ?? 'That did not look right.' });
    const e = error as { statusCode?: number; message?: string };
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
    if (status === 500) request.log.error({ event: 'unhandled_error', err: error });
    return reply.code(status).send({ error: status === 500 ? 'internal' : 'invalid', message: status === 500 ? 'Something went wrong. Try again in a minute.' : (e.message ?? 'That did not work.') });
  });

  const db = deps.db;
  const hh = (request: FastifyRequest) => request.kiosk!.householdId;
  const changed = async (householdId: string) => {
    deps.changes?.emit(householdId);
    await deps.notifyChange?.().catch(() => undefined);
  };
  const device = { config: { kiosk: 'device' as const } };

  app.post('/api/pair', { config: { kiosk: 'public' } }, async (request) => {
    const { code } = KioskPairRequest.parse(request.body);
    try {
      return await pairKiosk(db, code, now(), request.ip);
    } catch (err) {
      if (err instanceof KioskError && err.code === 'bad_code') request.log.info({ event: 'bad_code' });
      throw err;
    }
  });

  app.get('/api/me', device, async (request) => kioskMe(db, hh(request)));

  app.get<{ Params: { child: string } }>('/api/children/:child/home', device, async (request) => {
    const { child } = Child.parse(request.params);
    return kioskHome(db, deps.ledger, hh(request), child, now());
  });

  app.get<{ Params: { child: string } }>('/api/children/:child/targets', device, async (request) => {
    const { child } = Child.parse(request.params);
    await kioskChild(db, hh(request), child);
    return kioskTargets(db, hh(request));
  });

  app.get<{ Params: { child: string } }>('/api/children/:child/slots', device, async (request) => {
    const { child } = Child.parse(request.params);
    const q = SlotQuery.parse(request.query);
    return kioskSlots(db, deps.ledger, { householdId: hh(request), childId: child, target: { kind: q.kind, id: q.id }, minutes: q.minutes }, now());
  });

  app.post<{ Params: { child: string } }>('/api/children/:child/plan', device, async (request, reply) => {
    const { child } = Child.parse(request.params);
    const body = KioskPlanRequest.parse(request.body);
    await kioskChild(db, hh(request), child);
    const id = await planSession(db, deps.ledger, { childId: child, target: body.target, start: new Date(body.start), minutes: body.minutes }, now());
    await changed(hh(request));
    return reply.code(201).send({ id });
  });

  app.post<{ Params: { child: string } }>('/api/children/:child/ask', device, async (request, reply) => {
    const { child } = Child.parse(request.params);
    const body = KioskAskRequest.parse(request.body);
    if ((await openRequests(db, hh(request), child)) >= MAX_OPEN_REQUESTS) {
      throw new KioskError('too_many', "You've asked for three things already. Wait for a grown-up to answer those first.", 409);
    }
    const id = await askRequest(db, { childId: child, target: body.target, start: new Date(body.start), minutes: body.minutes }, now());
    await deps.queueAlert?.({ kind: 'request', id });
    await changed(hh(request));
    return reply.code(201).send({ id });
  });

  // The one route that takes a photo: a JPEG already shrunk on the tablet, as base64.
  app.post<{ Params: { child: string; task: string } }>('/api/children/:child/jobs/:task/done', { ...device, bodyLimit: 2_200_000 }, async (request, reply) => {
    const { child, task } = Job.parse(request.params);
    const body = KioskDoneRequest.parse(request.body ?? {});
    const id = await kioskDone(db, { householdId: hh(request), childId: child, taskId: task, photo: body.photo }, now());
    await deps.queueAlert?.({ kind: 'completion', id });
    await changed(hh(request));
    return reply.code(201).send({ id });
  });

  app.post<{ Params: { child: string } }>('/api/children/:child/ideas', device, async (request, reply) => {
    const { child } = Child.parse(request.params);
    const body = KioskIdeaRequest.parse(request.body);
    const id = await addIdea(db, { householdId: hh(request), childId: child, text: body.text, picture: body.picture }, now());
    return reply.code(201).send({ id });
  });

  app.post<{ Params: { child: string } }>('/api/children/:child/reflection', device, async (request) => {
    const { child } = Child.parse(request.params);
    const body = KioskReflectionRequest.parse(request.body);
    await saveReflection(db, { householdId: hh(request), childId: child, ...body }, now());
    await changed(hh(request));
    return { ok: true };
  });

  // The kiosk app itself: public, it holds nothing until paired.
  if (deps.staticDir) registerStatic(app, deps.staticDir);
  return app;
}
