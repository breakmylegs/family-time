import { helpFeedback, pushSubscriptions, type Db } from '@family-time/db';
import { HelpFeedbackRequest, PushSubscriptionRequest } from '@family-time/schemas';
import { and, desc, eq, inArray } from 'drizzle-orm';

/** Phones and browsers per person. The oldest goes when a new one joins. */
const MAX_SUBSCRIPTIONS = 5;
import type { FastifyInstance } from 'fastify';
import { parseBody } from './validate.js';

export interface PushRouteDeps {
  db: Db;
  now: () => Date;
  /** The VAPID public key browsers subscribe with. Absent until init.sh has made the key. */
  vapidPublicKey?: string;
}

/** Alerts on a phone (Web Push) and "Was this helpful?" on help topics. */
export async function pushRoutes(app: FastifyInstance, deps: PushRouteDeps): Promise<void> {
  const { db, now } = deps;

  app.get('/api/push/key', { config: { access: 'status.view' } }, async (_request, reply) => {
    if (!deps.vapidPublicKey) return reply.code(409).send({ error: 'push_not_set_up', detail: "Alerts aren't ready yet. Ask whoever set up Family time to finish setting up alerts (./scripts/init.sh, then ./scripts/update.sh)." });
    return { publicKey: deps.vapidPublicKey };
  });

  // One row per browser. Signing in on the same phone again moves the subscription to that person.
  app.post('/api/push/subscriptions', { config: { access: 'status.view' } }, async (request, reply) => {
    const body = parseBody(PushSubscriptionRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const userAgent = request.headers['user-agent']?.slice(0, 256) ?? null;
    await db
      .insert(pushSubscriptions)
      .values({ personId: me.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent, createdAt: now() })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { personId: me.id, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent, failures: 0, createdAt: now() } });
    const mine = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.personId, me.id)).orderBy(desc(pushSubscriptions.createdAt));
    const extra = mine.slice(MAX_SUBSCRIPTIONS).map((r) => r.id);
    if (extra.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, extra));
    return reply.code(201).send({ ok: true });
  });

  app.delete('/api/push/subscriptions', { config: { access: 'status.view' } }, async (request, reply) => {
    const body = parseBody(PushSubscriptionRequest.pick({ endpoint: true }), request, reply);
    if (!body) return reply;
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, body.endpoint), eq(pushSubscriptions.personId, request.auth!.person.id)));
    return reply.code(204).send();
  });

  app.get('/api/push/subscriptions/mine', { config: { access: 'status.view' } }, async (request) => {
    const rows = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.personId, request.auth!.person.id));
    return { endpoints: rows.map((r) => r.endpoint) };
  });

  app.post('/api/help/feedback', { config: { access: 'status.view' } }, async (request, reply) => {
    const body = parseBody(HelpFeedbackRequest, request, reply);
    if (!body) return reply;
    await db.insert(helpFeedback).values({ personId: request.auth!.person.id, topicId: body.topicId, helpful: body.helpful, createdAt: now() });
    return reply.code(201).send({ ok: true });
  });
}
