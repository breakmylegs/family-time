// Settings editors (Phase 9): the owner's screens for devices, groups and rules, and schedules, on
// the same commands as the command line. Every change wakes the reconciler, the only writer to AdGuard.
import type { Db } from '@family-time/db';
import { DeviceRequest, PolicyRequest, ScheduleRequest, ServiceGroupRequest } from '@family-time/schemas';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Changes } from '../events.js';
import { createDevice, createSchedule, removeDevice, removeSchedule, setGroupPolicy, setServiceGroup, SetupError, setupView, updateDevice, updateSchedule } from '../setup/commands.js';
import { parseBody } from './validate.js';

export interface SetupRouteDeps {
  db: Db;
  now: () => Date;
  changes: Changes;
  notifyChange: () => Promise<void>;
}

const Id = z.object({ id: z.uuid() });
type IdParams = { Params: { id: string } };
const owner = { config: { access: 'system.manage' as const } };

export async function setupRoutes(app: FastifyInstance, deps: SetupRouteDeps): Promise<void> {
  const { db, now, changes } = deps;

  /** Runs a change, wakes the reconciler, tells open screens, and answers. */
  const act = async (reply: FastifyReply, householdId: string, fn: () => Promise<unknown>, code = 200) => {
    try {
      const result = await fn();
      changes.emit(householdId);
      await deps.notifyChange().catch(() => undefined);
      return reply.code(code).send(result ?? { ok: true });
    } catch (err) {
      if (err instanceof SetupError) return reply.code(err.status).send({ error: err.code, detail: err.message });
      throw err;
    }
  };
  const idOf = (request: { params: unknown }, reply: FastifyReply) => {
    const parsed = Id.safeParse(request.params);
    if (!parsed.success) {
      void reply.code(404).send({ error: 'not_found', detail: "That isn't there any more. Reload to see the list now." });
      return undefined;
    }
    return parsed.data.id;
  };

  app.get('/api/setup', owner, async (request) => setupView(db, request.auth!.person.householdId));

  // ---- Devices
  app.post('/api/setup/devices', owner, async (request, reply) => {
    const body = parseBody(DeviceRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => createDevice(db, { householdId: me.householdId, childId: body.childId, label: body.label, type: body.type, ids: body.identifiers, actor: { personId: me.id } }), 201);
  });
  app.put<IdParams>('/api/setup/devices/:id', owner, async (request, reply) => {
    const id = idOf(request, reply);
    if (!id) return reply;
    const body = parseBody(DeviceRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => updateDevice(db, { householdId: me.householdId, deviceId: id, childId: body.childId, label: body.label, type: body.type, ids: body.identifiers, actor: { personId: me.id } }));
  });
  app.delete<IdParams>('/api/setup/devices/:id', owner, async (request, reply) => {
    const id = idOf(request, reply);
    if (!id) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => removeDevice(db, { householdId: me.householdId, deviceId: id, actor: { personId: me.id } }, now()));
  });

  // ---- Groups and each child's rule for them
  app.put('/api/setup/policies', owner, async (request, reply) => {
    const body = parseBody(PolicyRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => setGroupPolicy(db, { householdId: me.householdId, ...body, actor: { personId: me.id } }));
  });
  app.put<IdParams>('/api/setup/services/:id/group', owner, async (request, reply) => {
    const id = idOf(request, reply);
    if (!id) return reply;
    const body = parseBody(ServiceGroupRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => setServiceGroup(db, { householdId: me.householdId, serviceId: id, groupId: body.groupId, actor: { personId: me.id } }));
  });

  // ---- Schedules
  app.post('/api/setup/schedules', owner, async (request, reply) => {
    const body = parseBody(ScheduleRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => createSchedule(db, { householdId: me.householdId, schedule: body, actor: { personId: me.id } }), 201);
  });
  app.put<IdParams>('/api/setup/schedules/:id', owner, async (request, reply) => {
    const id = idOf(request, reply);
    if (!id) return reply;
    const body = parseBody(ScheduleRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => updateSchedule(db, { householdId: me.householdId, scheduleId: id, schedule: body, actor: { personId: me.id } }));
  });
  app.delete<IdParams>('/api/setup/schedules/:id', owner, async (request, reply) => {
    const id = idOf(request, reply);
    if (!id) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => removeSchedule(db, { householdId: me.householdId, scheduleId: id, actor: { personId: me.id } }));
  });
}
