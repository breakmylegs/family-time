// The whole family (Phase 9): the parents' own screen time, the family challenge and stopping points.
import type { Db } from '@family-time/db';
import { AgeBandRequest, ChallengeRequest, ChecklistTickRequest, MoodRequest, MyScreenTimeRequest, PraiseRequest, RuleAnswerRequest, SkillRequest, StoppingPointRequest, UnmanagedRequest } from '@family-time/schemas';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { can } from '../auth/capabilities.js';
import type { Changes } from '../events.js';
import { z } from 'zod';
import { addSkill, answerRuleAsk, childExtras, confirmSkill, ExtrasError, praiseJournal, removeSkill, setAgeBand, setMood, setUnmanaged, setupChecklists, tickChecklist } from '../family/extras.js';
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
      if (err instanceof FamilyError || err instanceof ExtrasError) return reply.code(err.status).send({ error: err.code, detail: err.message });
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

  // ---- Phase 11: the setup checklist, what the child did and can do, questions about rules, estimates
  const Id = z.object({ id: z.uuid() });
  const Item = z.object({ id: z.uuid(), item: z.string().max(40) });
  type P = { Params: { id: string } };
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

  app.get('/api/setup/checklists', { config: { access: 'rules.edit' } }, async (request) => setupChecklists(db, request.auth!.person.householdId));
  app.put<P>('/api/children/:id/age-band', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return notFound(reply);
    const body = parseBody(AgeBandRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => setAgeBand(db, { householdId: me.householdId, childId: id.data.id, by: me.id, ageBand: body.ageBand }));
  });
  app.put<{ Params: { id: string; item: string } }>('/api/children/:id/checklist/:item', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const p = Item.safeParse(request.params);
    if (!p.success) return notFound(reply);
    const body = parseBody(ChecklistTickRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => tickChecklist(db, { householdId: me.householdId, childId: p.data.id, by: me.id, itemId: p.data.item, done: body.done }));
  });

  // Carers see what the child did and can do, and can praise it; the rest is for parents.
  app.get<P>('/api/children/:id/extras', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return notFound(reply);
    const me = request.auth!.person;
    try {
      return await childExtras(db, me.householdId, id.data.id, now(), can(me.role, 'rules.edit'));
    } catch (err) {
      if (err instanceof ExtrasError) return reply.code(err.status).send({ error: err.code, detail: err.message });
      throw err;
    }
  });
  app.put<P>('/api/children/:id/unmanaged', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return notFound(reply);
    const body = parseBody(UnmanagedRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => setUnmanaged(db, { householdId: me.householdId, childId: id.data.id, by: me.id, minutes: body.minutes }, now()));
  });
  app.put<P>('/api/children/:id/mood', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return notFound(reply);
    const body = parseBody(MoodRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => setMood(db, { householdId: me.householdId, childId: id.data.id, by: me.id, rating: body.rating, note: body.note || null }, now()));
  });
  app.post<P>('/api/journal/:id/praise', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return notFound(reply);
    const body = parseBody(PraiseRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => praiseJournal(db, { householdId: me.householdId, entryId: id.data.id, by: me.id, text: body.text }, now()));
  });
  app.post<P>('/api/children/:id/skills', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return notFound(reply);
    const body = parseBody(SkillRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, async () => ({ id: await addSkill(db, { householdId: me.householdId, childId: id.data.id, title: body.title, picture: body.picture }, now()) }));
  });
  app.put<P>('/api/skills/:id', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return notFound(reply);
    const body = parseBody(z.object({ mastered: z.boolean() }), request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => confirmSkill(db, { householdId: me.householdId, skillId: id.data.id, by: me.id, mastered: body.mastered }, now()));
  });
  app.delete<P>('/api/skills/:id', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return notFound(reply);
    const me = request.auth!.person;
    return act(reply, me.householdId, () => removeSkill(db, { householdId: me.householdId, skillId: id.data.id, by: me.id }, now()));
  });
  app.post<P>('/api/rule-asks/:id/answer', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return notFound(reply);
    const body = parseBody(RuleAnswerRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => answerRuleAsk(db, { householdId: me.householdId, askId: id.data.id, by: me.id, action: body.action, answer: body.answer }, now()));
  });
}
