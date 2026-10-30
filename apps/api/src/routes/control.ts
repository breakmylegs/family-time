import { devices, overrides, people, services, type Db } from '@family-time/db';
import { EndingRequest, NormalRequest, OverrideRequest, type ChildSummary, type DiscoveredDomain } from '@family-time/schemas';
import { and, count, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { can } from '../auth/capabilities.js';
import { childStatus, ControlError, endOverride, endOverrides, findChild, reinstateOverrides, setOverride } from '../control/commands.js';
import { recordEnding, todayHistory } from '../control/history.js';
import type { Changes } from '../events.js';
import { parseBody } from './validate.js';

/** One query log entry, as much of it as discovery needs. */
export interface QueryLogEntry {
  time: string;
  client: string;
  client_info?: { name: string };
  question: { name: string };
}

export interface ControlRouteDeps {
  db: Db;
  now: () => Date;
  /** Wakes the reconciler, so a change reaches AdGuard in seconds, not at the next minute. */
  notifyChange: () => Promise<void>;
  /** Reads AdGuard's query log. Absent until AdGuard is set up. Read-only: the api never writes AdGuard. */
  readQuerylog?: (limit: number) => Promise<QueryLogEntry[]>;
  /** Tells open Control screens that something changed. */
  changes?: Changes;
}

export async function controlRoutes(app: FastifyInstance, deps: ControlRouteDeps): Promise<void> {
  const { db, now } = deps;

  const nudge = async (householdId: string) => {
    deps.changes?.emit(householdId);
    try {
      await deps.notifyChange();
    } catch {
      // The reconciler runs every minute anyway; a missed nudge only delays the change.
    }
  };

  const sendControlError = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ControlError) return reply.code(400).send({ error: err.code, detail: err.message });
    throw err;
  };

  app.get('/api/children', { config: { access: 'status.view' } }, async (request): Promise<ChildSummary[]> => {
    const me = request.auth!.person;
    const rows = await db
      .select({ id: people.id, name: people.displayName, devices: count(devices.id) })
      .from(people)
      .leftJoin(devices, eq(devices.childId, people.id))
      .where(and(eq(people.householdId, me.householdId), eq(people.role, 'child'), eq(people.active, true)))
      .groupBy(people.id);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });

  app.get<{ Params: { id: string } }>('/api/children/:id/status', { config: { access: 'status.view' } }, async (request, reply) => {
    const child = await findChild(db, request.auth!.person.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: 'That child is not in this family.' });
    return childStatus(db, child.id, now());
  });

  // Pause needs control.pause, which carers have. Allow and Block need control.change.
  app.post<{ Params: { id: string } }>('/api/children/:id/overrides', { config: { access: 'control.pause' } }, async (request, reply) => {
    const body = parseBody(OverrideRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    if (body.type !== 'pause' && !can(me.role, 'control.change')) {
      return reply.code(403).send({ error: 'forbidden', detail: 'Carers can pause, but not allow or block.' });
    }
    const child = await findChild(db, me.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: 'That child is not in this family.' });
    try {
      const t = now();
      await setOverride(db, { householdId: me.householdId, childId: child.id, byPersonId: me.id, request: body, ip: request.ip }, t);
      await nudge(me.householdId);
      return reply.code(201).send(await childStatus(db, child.id, t));
    } catch (err) {
      return sendControlError(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>('/api/children/:id/normal', { config: { access: 'control.change' } }, async (request, reply) => {
    const body = parseBody(NormalRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const child = await findChild(db, me.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: 'That child is not in this family.' });
    const t = now();
    await endOverrides(db, { householdId: me.householdId, childId: child.id, byPersonId: me.id, target: body.target, kinds: ['allow', 'block'], ip: request.ip }, t);
    await nudge(me.householdId);
    return childStatus(db, child.id, t);
  });

  app.post<{ Params: { id: string } }>('/api/children/:id/resume', { config: { access: 'control.pause' } }, async (request, reply) => {
    const me = request.auth!.person;
    const child = await findChild(db, me.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: 'That child is not in this family.' });
    const t = now();
    await endOverrides(db, { householdId: me.householdId, childId: child.id, byPersonId: me.id, kinds: ['pause'], ip: request.ip }, t);
    await nudge(me.householdId);
    return childStatus(db, child.id, t);
  });

  // Undo of an Allow, Block or Pause just made. The same rights as making it.
  app.post<{ Params: { id: string; overrideId: string } }>('/api/children/:id/overrides/:overrideId/end', { config: { access: 'control.pause' } }, async (request, reply) => {
    const me = request.auth!.person;
    const child = await findChild(db, me.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: 'That child is not in this family.' });
    if (!/^[0-9a-f-]{36}$/i.test(request.params.overrideId)) return reply.code(404).send({ error: 'not_found' });
    const o = (await db.select({ type: overrides.type }).from(overrides).where(and(eq(overrides.id, request.params.overrideId), eq(overrides.childId, child.id))))[0];
    if (o && o.type !== 'pause' && !can(me.role, 'control.change')) {
      return reply.code(403).send({ error: 'forbidden', detail: 'Carers can pause, but not allow or block.' });
    }
    const t = now();
    const ended = o ? await endOverride(db, { householdId: me.householdId, childId: child.id, byPersonId: me.id, overrideId: request.params.overrideId, ip: request.ip }, t) : undefined;
    if (!ended) return reply.code(409).send({ error: 'already_ended', detail: 'That has already ended.' });
    await nudge(me.householdId);
    return childStatus(db, child.id, t);
  });

  // Undo of Normal: puts back what this parent's Normal ended a moment ago.
  app.post<{ Params: { id: string } }>('/api/children/:id/normal/undo', { config: { access: 'control.change' } }, async (request, reply) => {
    const body = parseBody(NormalRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const child = await findChild(db, me.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: 'That child is not in this family.' });
    const t = now();
    const count = await reinstateOverrides(db, { householdId: me.householdId, childId: child.id, byPersonId: me.id, target: body.target, ip: request.ip }, t);
    if (!count) return reply.code(409).send({ error: 'too_late', detail: 'That can no longer be undone. Allow or Block it again instead.' });
    await nudge(me.householdId);
    return childStatus(db, child.id, t);
  });

  app.get<{ Params: { id: string } }>('/api/children/:id/history', { config: { access: 'status.view' } }, async (request, reply) => {
    const me = request.auth!.person;
    const child = await findChild(db, me.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: 'That child is not in this family.' });
    return todayHistory(db, me.householdId, child.id, now());
  });

  // The conflict tap: calm, grumble or meltdown. Anyone who can see status can tap it.
  app.post<{ Params: { id: string } }>('/api/children/:id/endings', { config: { access: 'status.view' } }, async (request, reply) => {
    const body = parseBody(EndingRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const child = await findChild(db, me.householdId, request.params.id);
    if (!child) return reply.code(404).send({ error: 'not_found', detail: 'That child is not in this family.' });
    const ok = await recordEnding(db, { householdId: me.householdId, childId: child.id, byPersonId: me.id, request: body }, now());
    if (!ok) return reply.code(404).send({ error: 'not_found', detail: "That session is not in today's history." });
    deps.changes?.emit(me.householdId);
    return reply.code(201).send({ ok: true });
  });

  // The discovery helper: what a device asked for in the last 30 minutes, so a parent can turn a
  // new game into a custom service. Counts only; nothing from the log is stored.
  app.get<{ Params: { id: string } }>('/api/devices/:id/discovery', { config: { access: 'system.manage' } }, async (request, reply) => {
    const me = request.auth!.person;
    if (!deps.readQuerylog) return reply.code(409).send({ error: 'adguard_not_set_up', detail: 'AdGuard is not set up yet. Run ./scripts/ft.sh adguard-setup on the server.' });
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send({ error: 'not_found' });
    const device = (await db.select().from(devices).where(and(eq(devices.id, request.params.id), eq(devices.householdId, me.householdId))))[0];
    if (!device) return reply.code(404).send({ error: 'not_found', detail: 'That device is not in this family.' });
    const since = now().getTime() - 30 * 60_000;
    const entries = await deps.readQuerylog(1000);
    const known = await db.select({ name: services.name, domains: services.domains }).from(services).where(eq(services.householdId, me.householdId));
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (new Date(e.time).getTime() < since) continue;
      const mine = e.client_info?.name === device.adguardName || device.identifiers.includes(e.client);
      if (!mine) continue;
      const domain = e.question.name.toLowerCase().replace(/\.$/, '');
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    const serviceOf = (domain: string) => known.find((s) => s.domains.some((d) => domain === d || domain.endsWith(`.${d}`)))?.name ?? null;
    const out: DiscoveredDomain[] = [...counts]
      .map(([domain, queries]) => ({ domain, queries, service: serviceOf(domain) }))
      .sort((a, b) => b.queries - a.queries)
      .slice(0, 30);
    return out;
  });
}
