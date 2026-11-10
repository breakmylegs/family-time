import { households, passkeys, people, webauthnChallenges, type Db } from '@family-time/db';
import {
  InviteLookupRequest,
  LoginVerifyRequest,
  RegisterOptionsRequest,
  RegisterVerifyRequest,
  type AuthState,
  type InviteLookup,
  type Me,
} from '@family-time/schemas';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { audit } from '../audit.js';
import { capabilitiesOf } from '../auth/capabilities.js';
import { clearCookie, CSRF_COOKIE, serializeCookie, SESSION_COOKIE } from '../auth/cookies.js';
import { consumeInvite, findUsableInvite } from '../auth/invites.js';
import { AUTH_RATE_LIMIT } from '../auth/ratelimit.js';
import { createSession, endSession, SESSION_ABSOLUTE_MS, type SessionPerson } from '../auth/sessions.js';
import { randomToken } from '../auth/tokens.js';
import { theHousehold, webOrigin } from '../settings.js';
import { parseBody } from './validate.js';

const CHALLENGE_MS = 5 * 60 * 1000;
const RP_NAME = 'Family time';

export interface AuthRouteDeps {
  db: Db;
  now: () => Date;
  /** Whether the sign-in screen offers Authentik: set up and linked to at least one owner. */
  ssoOffered?: () => Promise<boolean>;
}

export async function authRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  const { db, now } = deps;
  const publicLimited = { access: 'public' as const, rateLimit: AUTH_RATE_LIMIT };

  app.get('/api/auth/state', { config: { access: 'public' } }, async (request): Promise<AuthState> => {
    const household = await theHousehold(db);
    const owners = household
      ? await db.select({ id: people.id }).from(people).where(and(eq(people.householdId, household.id), eq(people.role, 'owner'), eq(people.active, true))).limit(1)
      : [];
    const me = request.auth ? await meOf(db, request.auth.person) : null;
    return { setup: owners.length ? 'ready' : 'needs-owner', me, sso: owners.length ? ((await deps.ssoOffered?.()) ?? false) : false };
  });

  app.get('/api/me', { config: { access: 'session' } }, async (request): Promise<Me> => meOf(db, request.auth!.person));

  // Invite and recovery links

  app.post('/api/invites/lookup', { config: publicLimited }, async (request, reply) => {
    const body = parseBody(InviteLookupRequest, request, reply);
    if (!body) return reply;
    const invite = await findUsableInvite(db, body.token, now());
    if (!invite) return invalidInvite(reply);
    const result: InviteLookup = {
      kind: invite.kind,
      householdName: invite.householdName,
      displayName: (invite.kind === 'join' ? invite.displayName : invite.personName) ?? '',
      role: invite.kind === 'join' ? invite.role! : 'owner',
    };
    if (invite.kind === 'recovery') {
      const rows = await db.select({ role: people.role }).from(people).where(eq(people.id, invite.personId!));
      result.role = rows[0]!.role;
    }
    return result;
  });

  app.post('/api/invites/register/options', { config: publicLimited }, async (request, reply) => {
    const body = parseBody(RegisterOptionsRequest, request, reply);
    if (!body) return reply;
    const invite = await findUsableInvite(db, body.token, now());
    if (!invite) return invalidInvite(reply);
    const site = await webOrigin(db, invite.householdId);
    if (!site) return notSetUp(reply);
    const existing = invite.personId
      ? await db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.personId, invite.personId))
      : [];
    const userName = (invite.kind === 'join' ? invite.displayName : invite.personName) ?? 'Family time';
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: site.rpId,
      userName,
      userDisplayName: userName,
      userID: randomBytes(16),
      attestationType: 'none',
      // Stored on the phone, so sign-in needs no name, and unlocked with Face ID or the passcode.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
    });
    const challengeId = await saveChallenge(db, options.challenge, 'register', { inviteId: invite.id }, now());
    return { challengeId, options };
  });

  app.post('/api/invites/register/verify', { config: publicLimited }, async (request, reply) => {
    const body = parseBody(RegisterVerifyRequest, request, reply);
    if (!body) return reply;
    const t = now();
    const invite = await findUsableInvite(db, body.token, t);
    if (!invite) return invalidInvite(reply);
    const challenge = await takeChallenge(db, body.challengeId, 'register', t);
    if (!challenge || challenge.inviteId !== invite.id) return expiredChallenge(reply);
    const site = await webOrigin(db, invite.householdId);
    if (!site) return notSetUp(reply);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: site.origin,
        expectedRPID: site.rpId,
        requireUserVerification: true,
      });
    } catch (err) {
      request.log.warn({ event: 'passkey_register_failed', err: (err as Error).message });
      return reply.code(400).send({ error: 'passkey_failed', detail: 'That passkey could not be checked. Try again.' });
    }
    if (!verification.verified) return reply.code(400).send({ error: 'passkey_failed', detail: 'That passkey could not be checked. Try again.' });
    const info = verification.registrationInfo;

    const person = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      if (!(await consumeInvite(txDb, invite.id, t))) return undefined;
      let personId = invite.personId;
      if (invite.kind === 'join') {
        const rows = await txDb
          .insert(people)
          .values({ householdId: invite.householdId, displayName: invite.displayName!, role: invite.role!, createdAt: t })
          .returning({ id: people.id });
        personId = rows[0]!.id;
      }
      await txDb.insert(passkeys).values({
        id: info.credential.id,
        personId: personId!,
        publicKey: info.credential.publicKey,
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        label: body.label ?? deviceLabel(request.headers['user-agent']),
        createdAt: t,
      });
      const rows = await txDb
        .select({ id: people.id, householdId: people.householdId, displayName: people.displayName, role: people.role })
        .from(people)
        .where(eq(people.id, personId!));
      return rows[0];
    });
    if (!person) return invalidInvite(reply);

    await audit(
      db,
      {
        householdId: person.householdId,
        actor: { personId: person.id },
        action: invite.kind === 'join' ? 'invite.redeemed' : 'recovery.passkey_added',
        targetType: 'person',
        targetId: person.id,
        after: { role: person.role, passkey: info.credential.id.slice(0, 12) },
        ip: request.ip,
      },
      request.log,
    );
    await startSession(reply, db, person.id, request.headers['user-agent'], t);
    return meOf(db, person);
  });

  // Sign in with a passkey stored on the device. No name is typed.

  app.post('/api/auth/login/options', { config: publicLimited }, async (_request, reply) => {
    const household = await theHousehold(db);
    const site = household ? await webOrigin(db, household.id) : undefined;
    if (!site) return notSetUp(reply);
    const options = await generateAuthenticationOptions({ rpID: site.rpId, userVerification: 'required' });
    const challengeId = await saveChallenge(db, options.challenge, 'authenticate', {}, now());
    return { challengeId, options };
  });

  app.post('/api/auth/login/verify', { config: publicLimited }, async (request, reply) => {
    const body = parseBody(LoginVerifyRequest, request, reply);
    if (!body) return reply;
    const t = now();
    const challenge = await takeChallenge(db, body.challengeId, 'authenticate', t);
    if (!challenge) return expiredChallenge(reply);
    const rows = await db
      .select({
        passkey: { id: passkeys.id, publicKey: passkeys.publicKey, counter: passkeys.counter, transports: passkeys.transports },
        person: { id: people.id, householdId: people.householdId, displayName: people.displayName, role: people.role, active: people.active },
      })
      .from(passkeys)
      .innerJoin(people, eq(people.id, passkeys.personId))
      .where(eq(passkeys.id, body.response.id));
    const row = rows[0];
    const notRecognised = () =>
      reply.code(401).send({ error: 'passkey_unknown', detail: 'That passkey is not recognised here. Use the one you made when you joined, or ask the owner for a new invite.' });
    if (!row || !row.person.active) return notRecognised();
    const site = await webOrigin(db, row.person.householdId);
    if (!site) return notSetUp(reply);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: site.origin,
        expectedRPID: site.rpId,
        credential: { id: row.passkey.id, publicKey: new Uint8Array(row.passkey.publicKey), counter: row.passkey.counter, transports: row.passkey.transports },
        requireUserVerification: true,
      });
    } catch (err) {
      request.log.warn({ event: 'passkey_login_failed', err: (err as Error).message });
      return notRecognised();
    }
    if (!verification.verified) return notRecognised();

    await db.update(passkeys).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: t }).where(eq(passkeys.id, row.passkey.id));
    const { active: _active, ...person } = row.person;
    await audit(db, { householdId: person.householdId, actor: { personId: person.id }, action: 'auth.signed_in', ip: request.ip }, request.log);
    await startSession(reply, db, person.id, request.headers['user-agent'], t);
    return meOf(db, person);
  });

  app.post('/api/auth/logout', { config: { access: 'session' } }, async (request, reply) => {
    const auth = request.auth!;
    await endSession(db, auth.sessionHash);
    await audit(db, { householdId: auth.person.householdId, actor: { personId: auth.person.id }, action: 'auth.signed_out', ip: request.ip }, request.log);
    reply.header('set-cookie', [clearCookie(SESSION_COOKIE, true), clearCookie(CSRF_COOKIE, false)]);
    return { ok: true };
  });
}

async function meOf(db: Db, person: SessionPerson): Promise<Me> {
  const rows = await db.select({ name: households.name }).from(households).where(eq(households.id, person.householdId));
  return {
    id: person.id,
    displayName: person.displayName,
    role: person.role,
    capabilities: capabilitiesOf(person.role),
    householdName: rows[0]?.name ?? '',
  };
}

/** A new session id every time someone signs in, and a fresh CSRF token with it. */
export async function startSession(reply: FastifyReply, db: Db, personId: string, userAgent: string | undefined, now: Date) {
  const sessionId = await createSession(db, personId, userAgent, now);
  const maxAgeSeconds = Math.floor(SESSION_ABSOLUTE_MS / 1000);
  reply.header('set-cookie', [
    serializeCookie(SESSION_COOKIE, sessionId, { maxAgeSeconds, httpOnly: true }),
    // Readable by the page, which sends it back in a header on every change.
    serializeCookie(CSRF_COOKIE, randomToken(), { maxAgeSeconds, httpOnly: false }),
  ]);
}

async function saveChallenge(
  db: Db,
  challenge: string,
  purpose: 'register' | 'authenticate',
  links: { inviteId?: string },
  now: Date,
): Promise<string> {
  const rows = await db
    .insert(webauthnChallenges)
    .values({ challenge, purpose, inviteId: links.inviteId ?? null, createdAt: now, expiresAt: new Date(now.getTime() + CHALLENGE_MS) })
    .returning({ id: webauthnChallenges.id });
  return rows[0]!.id;
}

/** Each challenge answers once: it is deleted as it is read. */
async function takeChallenge(db: Db, id: string, purpose: 'register' | 'authenticate', now: Date) {
  const rows = await db
    .delete(webauthnChallenges)
    .where(and(eq(webauthnChallenges.id, id), eq(webauthnChallenges.purpose, purpose), gt(webauthnChallenges.expiresAt, now)))
    .returning({ challenge: webauthnChallenges.challenge, inviteId: webauthnChallenges.inviteId });
  return rows[0];
}

function invalidInvite(reply: FastifyReply) {
  return reply.code(404).send({ error: 'invite_invalid', detail: 'This link has expired or has already been used. Ask for a new one.' });
}

function expiredChallenge(reply: FastifyReply) {
  return reply.code(400).send({ error: 'challenge_expired', detail: 'That took too long. Try again.' });
}

function notSetUp(reply: FastifyReply) {
  return reply.code(409).send({ error: 'not_set_up', detail: 'Family time is not set up yet. Run ./scripts/ft.sh owner-invite on the server.' });
}

/** A readable default name for a passkey, from the browser. */
function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows computer';
  return 'Passkey';
}
