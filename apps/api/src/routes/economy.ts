import { households, type Db } from '@family-time/db';
import { features, type PilotPhase } from '@family-time/domain';
import type { LedgerPort } from '@family-time/ledger';
import {
  AllowanceRequest,
  type ApprovalItem,
  ApproveRequest,
  ConvertRequest,
  DecideRequestBody,
  GoalRequest,
  PayoutRequest,
  PilotPhaseRequest,
  PlanRequest,
  RefundPointsRequest,
  ReverseRequest,
  TaskInput,
} from '@family-time/schemas';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { can } from '../auth/capabilities.js';
import { findChild } from '../control/commands.js';
import {
  agreeStep,
  approvalsFor,
  approveCompletion,
  approveRequest,
  archiveTask,
  chainLedger,
  convertFlex,
  createTask,
  EconomyError,
  ledgerLines,
  listTasks,
  notYetCompletion,
  notYetRequest,
  recordPayout,
  refundPoints,
  reverseEntry,
  setAllowance,
  setGoal,
  setPilotPhase,
  setPlan,
  unagreeStep,
  undoCompletion,
  undoRequest,
  updateTask,
  waitingCount,
  weekSummary,
} from '../economy/commands.js';
import { proposalItems, waitingProposals } from '../ai/proposals.js';
import type { Changes } from '../events.js';
import { parseBody } from './validate.js';

export interface EconomyRouteDeps {
  db: Db;
  ledger: LedgerPort;
  now: () => Date;
  changes: Changes;
  /** Wakes the reconciler: an approved request is a grant AdGuard must honour. */
  notifyChange: () => Promise<void>;
  /** Which ledger is running, for the owner's Ledger screen. */
  ledgerAdapter?: 'postgres' | 'besu';
}

type Id = { Params: { id: string } };
const NO_CHILD = { error: 'not_found', detail: "Family time can't find that child. Reload to see who's in your family now." };
const NO_JOB = { error: 'not_found', detail: "That job isn't on the list any more. Reload to see the list now." };

export async function economyRoutes(app: FastifyInstance, deps: EconomyRouteDeps): Promise<void> {
  const { db, ledger, now, changes } = deps;

  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof EconomyError) return reply.code(err.status).send({ error: err.code, detail: err.message });
    throw err;
  };
  /** Runs a change, tells open screens, and answers with the result or the reason it could not. */
  const act = async (reply: FastifyReply, householdId: string, fn: () => Promise<unknown>, code = 200) => {
    try {
      const result = await fn();
      changes.emit(householdId);
      return reply.code(code).send(result ?? { ok: true });
    } catch (err) {
      return fail(reply, err);
    }
  };

  // ---- The week and the child's ledger
  app.get<Id>('/api/children/:id/week', { config: { access: 'status.view' } }, async (request, reply) => {
    const child = await findChild(db, request.auth!.person.householdId, request.params.id);
    if (!child) return reply.code(404).send(NO_CHILD);
    const week = await weekSummary(db, ledger, child.id, now());
    // The child's Sunday answers are for the parents who run the family review, not every carer.
    return can(request.auth!.person.role, 'rules.edit') ? week : { ...week, reflection: null };
  });

  // The full history is a parent's: carers see the week's balances on Family, not every entry.
  app.get<Id>('/api/children/:id/ledger', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const child = await findChild(db, request.auth!.person.householdId, request.params.id);
    if (!child) return reply.code(404).send(NO_CHILD);
    return ledgerLines(db, ledger, child.id, now());
  });

  // ---- Approvals
  // The owner's Ledger screen: every entry, with its block and transaction on the Besu ledger.
  app.get('/api/ledger/entries', { config: { access: 'system.manage' } }, async (request) => chainLedger(db, request.auth!.person.householdId, now(), deps.ledgerAdapter ?? 'postgres'));
  app.get('/api/approvals', { config: { access: 'approvals.decide' } }, async (request) => {
    const householdId = request.auth!.person.householdId;
    const t = now();
    // Suggestions from AI and connected apps go first, newest first: they go after 30 minutes.
    const suggested = (await proposalItems(db, householdId, t)).sort((a, b) => b.sortAt - a.sortAt).map(({ sortAt: _sortAt, ...item }): ApprovalItem => item);
    return [...suggested, ...(await approvalsFor(db, ledger, householdId, t))];
  });
  app.get('/api/approvals/count', { config: { access: 'status.view' } }, async (request) => {
    const householdId = request.auth!.person.householdId;
    return { waiting: (await waitingCount(db, householdId)) + (await waitingProposals(db, householdId, now())) };
  });

  app.post<Id>('/api/completions/:id/approve', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const body = parseBody(ApproveRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => approveCompletion(db, ledger, { householdId: me.householdId, completionId: request.params.id, by: me.id, note: body.note }, now()));
  });
  app.post<Id>('/api/completions/:id/not-yet', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const body = parseBody(ApproveRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => notYetCompletion(db, { householdId: me.householdId, completionId: request.params.id, by: me.id, note: body.note }, now()));
  });
  app.post<Id>('/api/completions/:id/undo', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const me = request.auth!.person;
    return act(reply, me.householdId, () => undoCompletion(db, ledger, { householdId: me.householdId, completionId: request.params.id, by: me.id }, now()));
  });

  app.post<Id>('/api/requests/:id/approve', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const body = parseBody(DecideRequestBody, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    // Carers approve within the plan; extra time beyond the allowance is a parent's call.
    if (body.asExtra && !can(me.role, 'control.change')) return reply.code(403).send({ error: 'forbidden', detail: 'Only a parent can say yes as extra time.' });
    const result = await act(reply, me.householdId, () => approveRequest(db, ledger, { householdId: me.householdId, requestId: request.params.id, by: me.id, asExtra: body.asExtra }, now()));
    await deps.notifyChange().catch(() => undefined);
    return result;
  });
  app.post<Id>('/api/requests/:id/not-yet', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const me = request.auth!.person;
    return act(reply, me.householdId, () => notYetRequest(db, { householdId: me.householdId, requestId: request.params.id, by: me.id }, now()));
  });
  app.post<Id>('/api/requests/:id/undo', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const me = request.auth!.person;
    const result = await act(reply, me.householdId, () => undoRequest(db, ledger, { householdId: me.householdId, requestId: request.params.id, by: me.id }, now()));
    await deps.notifyChange().catch(() => undefined);
    return result;
  });

  // ---- Jobs
  app.get('/api/tasks', { config: { access: 'status.view' } }, async (request) => listTasks(db, request.auth!.person.householdId));
  app.post('/api/tasks', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const task = parseBody(TaskInput, request, reply);
    if (!task) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, () => createTask(db, { householdId: me.householdId, by: me.id, task }, now()), 201);
  });
  app.put<Id>('/api/tasks/:id', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const task = parseBody(TaskInput, request, reply);
    if (!task) return reply;
    const me = request.auth!.person;
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send(NO_JOB);
    return act(reply, me.householdId, () => updateTask(db, { householdId: me.householdId, by: me.id, taskId: request.params.id, task }));
  });
  app.delete<Id>('/api/tasks/:id', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const me = request.auth!.person;
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send(NO_JOB);
    return act(reply, me.householdId, () => archiveTask(db, { householdId: me.householdId, by: me.id, taskId: request.params.id }));
  });
  // Undo of Remove: jobs are archived, so they can come back.
  app.post<Id>('/api/tasks/:id/restore', { config: { access: 'rules.edit' } }, async (request, reply) => {
    const me = request.auth!.person;
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send(NO_JOB);
    return act(reply, me.householdId, () => archiveTask(db, { householdId: me.householdId, by: me.id, taskId: request.params.id, active: true }));
  });

  // ---- Money, points and the plan: a parent's
  const childAction = <S extends z.ZodType>(path: string, schema: S, method: 'post' | 'put', fn: (ctx: { householdId: string; childId: string; by: string; body: z.infer<S> }) => Promise<unknown>) => {
    app[method]<Id>(path, { config: { access: 'rules.edit' } }, async (request, reply) => {
      const body = parseBody(schema, request, reply);
      if (body === undefined) return reply;
      const me = request.auth!.person;
      const child = await findChild(db, me.householdId, request.params.id);
      if (!child) return reply.code(404).send(NO_CHILD);
      return act(reply, me.householdId, () => fn({ householdId: me.householdId, childId: child.id, by: me.id, body }));
    });
  };
  childAction('/api/children/:id/payouts', PayoutRequest, 'post', (c) => recordPayout(db, ledger, { ...c, pence: c.body.pence, key: c.body.key }, now()));
  childAction('/api/children/:id/convert', ConvertRequest, 'post', (c) => convertFlex(db, ledger, { ...c, points: c.body.points, to: c.body.to, key: c.body.key }, now()));
  childAction('/api/children/:id/refund-points', RefundPointsRequest, 'post', (c) => refundPoints(db, ledger, { ...c, points: c.body.points, reason: c.body.reason, key: c.body.key }, now()));
  childAction('/api/children/:id/reverse', ReverseRequest, 'post', (c) => reverseEntry(db, ledger, { ...c, entryRef: c.body.entryRef }, now()));
  childAction('/api/children/:id/allowance', AllowanceRequest, 'put', (c) => setAllowance(db, { ...c, minutes: c.body.minutes }, now()));
  childAction('/api/children/:id/plan', PlanRequest, 'put', (c) => setPlan(db, { ...c, plan: c.body }, now()));
  childAction('/api/children/:id/plan/agree', z.object({}), 'post', (c) => agreeStep(db, c, now()));
  childAction('/api/children/:id/plan/unagree', z.object({}), 'post', (c) => unagreeStep(db, c, now()));
  childAction('/api/children/:id/goal', GoalRequest, 'put', (c) => setGoal(db, { ...c, title: c.body.title, targetPence: c.body.targetPence }, now()));

  // ---- The pilot phase: anyone signed in can see it, the owner sets it
  app.get('/api/household/pilot', { config: { access: 'status.view' } }, async (request) => {
    const hh = (await db.select({ phase: households.pilotPhase }).from(households).where(eq(households.id, request.auth!.person.householdId)))[0];
    const phase = (hh?.phase ?? 'baseline') as PilotPhase;
    return { phase, features: features(phase) };
  });
  app.put('/api/household/pilot', { config: { access: 'system.manage' } }, async (request, reply) => {
    const body = parseBody(PilotPhaseRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    return act(reply, me.householdId, async () => {
      await setPilotPhase(db, { householdId: me.householdId, by: me.id, phase: body.phase });
      return { phase: body.phase, features: features(body.phase) };
    });
  });
}
