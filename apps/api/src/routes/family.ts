// The whole family (Phase 9): the parents' own screen time, the family challenge and stopping points.
import type { Db } from '@family-time/db';
import { ChallengeRequest, MyScreenTimeRequest, StoppingPointRequest } from '@family-time/schemas';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { can } from '../auth/capabilities.js';
import type { Changes } from '../events.js';
import { endChallenge, FamilyError, setChallenge, setMyScreenTime, setStoppingPoint, tickChallenge, wholeFamily } from '../family/whole.js';
import { parseBody } from './validate.js';

export interface FamilyRouteDeps {
  db: Db;
  now: () => Date;
  changes: Changes;
  /** Wakes the reconciler: stopping points change when blocks begin. */
  notifyChange: () => Promise<void>;
}

export async function familyRoutes(app: FastifyInstance, deps: FamilyRouteDeps): Promise<void> {
  const { db, now, changes } = deps;

  const act = async (reply: FastifyReply, householdId: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      changes.emit(householdId);
      return reply.send(result ?? { ok: true });
    } catch (err) {
      if (err instanceof FamilyError) return reply.code(err.status).send({ error: err.code, detail: err.message });
      throw err;
    }
  };

  app.get('/api/family/whole', { config: { access: 'status.view' } }, async (request) => {
    const me = request.auth!.person;
    return wholeFamily(db, me.householdId, me.id, now(), can(me.role, 'rules.edit'));
  });

  // A parent's own leisure screen time this week, in their own words. Carers are not asked.
  app.put('/api/family/my-screen-time', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const body = parseBody(MyScreenTimeRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => setMyScreenTime(db, { householdId: me.householdId, personId: me.id, minutes: body.minutes }, now()));
  });

  app.put('/api/family/challenge', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const body = parseBody(ChallengeRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => setChallenge(db, { householdId: me.householdId, by: me.id, title: body.title, target: body.target }, now()));
  });
  app.delete('/api/family/challenge', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const me = request.auth!.person;
    return act(reply, me.householdId, () => endChallenge(db, { householdId: me.householdId, by: me.id }, now()));
  });
  // Anyone signed in can say "we did it", grandparents included.
  app.post('/api/family/challenge/tick', { config: { access: 'status.view' } }, async (request, reply) => {
    const me = request.auth!.person;
    return act(reply, me.householdId, () => tickChallenge(db, { householdId: me.householdId, by: me.id }, now()));
  });

  app.put('/api/family/stopping-point', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const body = parseBody(StoppingPointRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const result = await act(reply, me.householdId, () => setStoppingPoint(db, { householdId: me.householdId, by: me.id, minutes: body.minutes }));
    await deps.notifyChange().catch(() => undefined);
    return result;
  });
}
