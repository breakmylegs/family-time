import { invites, passkeys, people, type Db } from '@family-time/db';
import { ChangeRoleRequest, CreateInviteRequest, type Invite, type OpenInvite, type Person } from '@family-time/schemas';
import { and, asc, count, eq, gt, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { audit } from '../audit.js';
import { createJoinInvite, inviteLink, JOIN_INVITE_MS } from '../auth/invites.js';
import { revokeAllSessions } from '../auth/sessions.js';
import { webOrigin } from '../settings.js';
import { parseBody } from './validate.js';

export interface PeopleRouteDeps {
  db: Db;
  now: () => Date;
}

export async function peopleRoutes(app: FastifyInstance, deps: PeopleRouteDeps): Promise<void> {
  const { db, now } = deps;

  app.get('/api/people', { config: { access: 'people.view' } }, async (request): Promise<Person[]> => {
    const me = request.auth!.person;
    const rows = await db
      .select({ id: people.id, displayName: people.displayName, role: people.role, passkeys: count(passkeys.id) })
      .from(people)
      .leftJoin(passkeys, eq(passkeys.personId, people.id))
      .where(and(eq(people.householdId, me.householdId), eq(people.active, true), ne(people.role, 'child')))
      .groupBy(people.id)
      .orderBy(asc(people.createdAt));
    return rows.map((r) => ({ ...r, isMe: r.id === me.id }));
  });

  app.get('/api/people/invites', { config: { access: 'people.manage' } }, async (request): Promise<OpenInvite[]> => {
    const me = request.auth!.person;
    const rows = await db
      .select({ id: invites.id, displayName: invites.displayName, role: invites.role, expiresAt: invites.expiresAt })
      .from(invites)
      .where(and(eq(invites.householdId, me.householdId), eq(invites.kind, 'join'), isNull(invites.usedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now())))
      .orderBy(asc(invites.createdAt));
    return rows.map((r) => ({ id: r.id, displayName: r.displayName!, role: r.role as OpenInvite['role'], expiresAt: r.expiresAt.toISOString() }));
  });

  app.post('/api/people/invites', { config: { access: 'people.manage' } }, async (request, reply) => {
    const body = parseBody(CreateInviteRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const site = await webOrigin(db, me.householdId);
    if (!site) return reply.code(409).send({ error: 'not_set_up', detail: 'The web address is not set. Run ./scripts/ft.sh owner-invite on the server.' });
    const invite = await createJoinInvite(db, {
      householdId: me.householdId,
      role: body.role,
      displayName: body.displayName,
      createdBy: me.id,
      now: now(),
      ttlMs: JOIN_INVITE_MS,
    });
    await audit(
      db,
      { householdId: me.householdId, actor: { personId: me.id }, action: 'invite.created', targetType: 'invite', targetId: invite.id, after: body, ip: request.ip },
      request.log,
    );
    const result: Invite = { id: invite.id, link: inviteLink(site.origin, invite.token), expiresAt: invite.expiresAt.toISOString(), ...body };
    return reply.code(201).send(result);
  });

  app.delete<{ Params: { id: string } }>('/api/people/invites/:id', { config: { access: 'people.manage' } }, async (request, reply) => {
    const me = request.auth!.person;
    const rows = await db
      .update(invites)
      .set({ revokedAt: now() })
      .where(and(eq(invites.id, request.params.id), eq(invites.householdId, me.householdId), isNull(invites.usedAt), isNull(invites.revokedAt)))
      .returning({ id: invites.id });
    if (!rows.length) return reply.code(404).send({ error: 'not_found', detail: 'That invite has already been used or cancelled.' });
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'invite.revoked', targetType: 'invite', targetId: request.params.id, ip: request.ip }, request.log);
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/api/people/:id', { config: { access: 'people.manage' } }, async (request, reply) => {
    const body = parseBody(ChangeRoleRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const target = await findPerson(db, me.householdId, request.params.id);
    if (!target) return reply.code(404).send({ error: 'not_found', detail: 'That person is not in this family.' });
    if (target.role === body.role) return { ok: true };
    if (await refusedAsLastOwner(() => db.update(people).set({ role: body.role, ...(body.role === 'owner' ? {} : { oidcSubject: null }) }).where(eq(people.id, target.id)))) {
      return lastOwner(reply);
    }
    await revokeAllSessions(db, target.id);
    await audit(
      db,
      { householdId: me.householdId, actor: { personId: me.id }, action: 'person.role_changed', targetType: 'person', targetId: target.id, before: { role: target.role }, after: { role: body.role }, ip: request.ip },
      request.log,
    );
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/people/:id', { config: { access: 'people.manage' } }, async (request, reply) => {
    const me = request.auth!.person;
    const target = await findPerson(db, me.householdId, request.params.id);
    if (!target) return reply.code(404).send({ error: 'not_found', detail: 'That person is not in this family.' });
    if (await refusedAsLastOwner(() => db.update(people).set({ active: false, deactivatedAt: now(), oidcSubject: null }).where(eq(people.id, target.id)))) {
      return lastOwner(reply);
    }
    await revokeAllSessions(db, target.id);
    await audit(
      db,
      { householdId: me.householdId, actor: { personId: me.id }, action: 'person.removed', targetType: 'person', targetId: target.id, before: { role: target.role, displayName: target.displayName }, ip: request.ip },
      request.log,
    );
    return { ok: true };
  });
}

async function findPerson(db: Db, householdId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const rows = await db
    .select({ id: people.id, role: people.role, displayName: people.displayName })
    .from(people)
    .where(and(eq(people.id, id), eq(people.householdId, householdId), eq(people.active, true)));
  return rows[0];
}

/**
 * Runs a change the database may refuse because it would leave no owner. Returns true when it was
 * refused. It returns a boolean, not the reply: a Fastify reply is thenable, so awaiting one
 * resolves to undefined and the caller would carry on as if the change had worked.
 */
async function refusedAsLastOwner(change: () => Promise<unknown>): Promise<boolean> {
  try {
    await change();
    return false;
  } catch (err) {
    // Drizzle wraps the driver's error, so the trigger's message may be one level down in `cause`.
    const messages = [err, (err as { cause?: unknown }).cause].map((e) => String((e as { message?: string })?.message ?? ''));
    if (messages.some((m) => /last owner/.test(m))) return true;
    throw err;
  }
}

function lastOwner(reply: FastifyReply) {
  return reply.code(409).send({ error: 'last_owner', detail: 'This is the only owner. Make someone else an owner first.' });
}
