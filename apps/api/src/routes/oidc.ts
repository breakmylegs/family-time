// Optional owner sign-in through Authentik (brief Part 8). See auth/oidc.ts for the flow.
import { people, sessions, type Db } from '@family-time/db';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../audit.js';
import { clearCookie, parseCookies, serializeCookie } from '../auth/cookies.js';
import { NoPendingSignIn, Oidc, OIDC_COOKIE, OIDC_PENDING_MS, OidcUnreachable, SETTING_OWNER_SSO, type OwnerSso } from '../auth/oidc.js';
import { AUTH_RATE_LIMIT } from '../auth/ratelimit.js';
import { getSetting, theHousehold, webOrigin } from '../settings.js';
import { startSession } from './auth.js';

export interface OidcRouteDeps {
  db: Db;
  now: () => Date;
  /** Absent when secrets/oidc_client_secret is empty: sign-in through Authentik is off. */
  oidc?: Oidc;
}

export const CALLBACK_PATH = '/api/auth/oidc/callback';

/** The owner's sign-in through Authentik, when it is fully set up: the setting, the secret and the address. */
export async function ownerSso(db: Db, oidc: Oidc | undefined) {
  if (!oidc) return undefined;
  const household = await theHousehold(db);
  if (!household) return undefined;
  const sso = await getSetting<OwnerSso>(db, household.id, SETTING_OWNER_SSO);
  const site = await webOrigin(db, household.id);
  if (!sso?.issuer || !sso.clientId || !site) return undefined;
  return { sso, householdId: household.id, redirectUri: `${site.origin}${CALLBACK_PATH}`, origin: site.origin };
}

export async function oidcRoutes(app: FastifyInstance, deps: OidcRouteDeps): Promise<void> {
  const { db, now } = deps;
  const limited = { access: 'public' as const, rateLimit: AUTH_RATE_LIMIT };
  const pendingCookie = (value: string) => serializeCookie(OIDC_COOKIE, value, { maxAgeSeconds: Math.floor(OIDC_PENDING_MS / 1000), httpOnly: true });
  /** Back to the app, which says what happened from the `sso` parameter. */
  const back = (reply: FastifyReply, path: string) => reply.header('set-cookie', clearCookie(OIDC_COOKIE, true)).redirect(path, 303);

  // Whether the sign-in screen shows the button, and whether this owner has linked an account.
  app.get('/api/auth/oidc', { config: { access: 'session' } }, async (request) => {
    const s = await ownerSso(db, deps.oidc);
    const me = request.auth!.person;
    const linked = me.role === 'owner' ? Boolean((await db.select({ sub: people.oidcSubject }).from(people).where(eq(people.id, me.id)))[0]?.sub) : false;
    return { available: Boolean(s), linked };
  });

  // Signing in: straight to Authentik, and back to the callback.
  app.get('/api/auth/oidc/start', { config: limited }, async (request, reply) => {
    const s = await ownerSso(db, deps.oidc);
    if (!s) return reply.redirect('/?sso=off', 303);
    try {
      const { url, cookie } = await deps.oidc!.start(s.sso, s.redirectUri, now().getTime());
      return reply.header('set-cookie', pendingCookie(cookie)).redirect(url.href, 303);
    } catch (err) {
      request.log.warn({ event: 'oidc_start_failed', err: (err as Error).message });
      return reply.redirect('/?sso=unreachable', 303);
    }
  });

  // Linking, from Settings: a POST with the CSRF token, so a page elsewhere cannot start it.
  app.post('/api/auth/oidc/link', { config: { access: 'system.manage', rateLimit: AUTH_RATE_LIMIT } }, async (request, reply) => {
    const me = request.auth!.person;
    if (me.role !== 'owner') return reply.code(403).send({ error: 'forbidden', detail: 'Only an owner can sign in with Authentik.' });
    const s = await ownerSso(db, deps.oidc);
    if (!s) return reply.code(409).send({ error: 'sso_off', detail: 'Sign-in with Authentik is not set up on the server. See docs/setup/authentik.md.' });
    try {
      const { url, cookie } = await deps.oidc!.start(s.sso, s.redirectUri, now().getTime(), me.id);
      return reply.header('set-cookie', pendingCookie(cookie)).send({ url: url.href });
    } catch (err) {
      request.log.warn({ event: 'oidc_start_failed', err: (err as Error).message });
      return reply.code(502).send({ error: 'unreachable', detail: "Family time couldn't reach Authentik. Check it is running, then try again." });
    }
  });

  // Unlinking also signs this owner out everywhere else, in case the account was someone else's.
  // It works in maintenance mode, like signing out.
  app.post('/api/auth/oidc/unlink', { config: { access: 'system.manage' } }, async (request) => {
    const auth = request.auth!;
    const me = auth.person;
    await db.update(people).set({ oidcSubject: null }).where(eq(people.id, me.id));
    await db.delete(sessions).where(and(eq(sessions.personId, me.id), ne(sessions.idHash, auth.sessionHash)));
    await audit(db, { householdId: me.householdId, actor: { personId: me.id }, action: 'auth.oidc_unlinked', targetType: 'person', targetId: me.id, ip: request.ip }, request.log);
    return { ok: true };
  });

  app.get(CALLBACK_PATH, { config: limited }, async (request: FastifyRequest, reply) => {
    const s = await ownerSso(db, deps.oidc);
    if (!s) return back(reply, '/?sso=off');
    const t = now();
    let result;
    try {
      result = await deps.oidc!.finish(s.sso, new URL(request.url, s.origin), parseCookies(request.headers.cookie)[OIDC_COOKIE], t.getTime());
    } catch (err) {
      request.log.warn({ event: 'oidc_failed', err: (err as Error).message });
      // Someone calling the callback with no sign-in started is logged, not written to the audit log.
      if (!(err instanceof NoPendingSignIn)) {
        await audit(db, { householdId: s.householdId, actor: { label: 'oidc' }, action: 'auth.oidc_failed', after: { reason: (err as Error).message.slice(0, 200) }, ip: request.ip }, request.log);
      }
      return back(reply, err instanceof OidcUnreachable ? '/?sso=unreachable' : '/?sso=failed');
    }

    if (result.linkPersonId) {
      // Only the owner who started it, still signed in here, still an owner, and an Authentik
      // account no one else has.
      const refuse = async (why: string, path: string) => {
        await audit(db, { householdId: s.householdId, actor: { label: 'oidc' }, action: 'auth.oidc_link_refused', targetType: 'person', targetId: result.linkPersonId!, after: { why, account: result.username }, ip: request.ip }, request.log);
        return back(reply, path);
      };
      if (request.auth?.person.id !== result.linkPersonId) return refuse('the owner who started it is not signed in here', '/settings?sso=failed');
      const owner = (await db.select({ id: people.id, householdId: people.householdId, before: people.oidcSubject }).from(people).where(and(eq(people.id, result.linkPersonId), eq(people.role, 'owner'), eq(people.active, true))))[0];
      if (!owner) return refuse('no longer an owner', '/settings?sso=failed');
      const taken = (await db.select({ id: people.id }).from(people).where(eq(people.oidcSubject, result.subject)))[0];
      if (taken && taken.id !== owner.id) return refuse('the account is linked to someone else', '/settings?sso=taken');
      await db.update(people).set({ oidcSubject: result.subject }).where(eq(people.id, owner.id));
      await audit(db, { householdId: owner.householdId, actor: { personId: owner.id }, action: 'auth.oidc_linked', targetType: 'person', targetId: owner.id, before: { linked: Boolean(owner.before) }, after: { account: result.username }, ip: request.ip }, request.log);
      return back(reply, '/settings?sso=linked');
    }

    const person = (
      await db
        .select({ id: people.id, householdId: people.householdId })
        .from(people)
        .where(and(eq(people.oidcSubject, result.subject), eq(people.role, 'owner'), eq(people.active, true)))
    )[0];
    if (!person) {
      await audit(db, { householdId: s.householdId, actor: { label: 'oidc' }, action: 'auth.oidc_unknown', after: { account: result.username }, ip: request.ip }, request.log);
      return back(reply, '/?sso=unknown');
    }
    await audit(db, { householdId: person.householdId, actor: { personId: person.id }, action: 'auth.signed_in', after: { with: 'authentik', account: result.username }, ip: request.ip }, request.log);
    await startSession(reply, db, person.id, request.headers['user-agent'], t);
    return back(reply, '/');
  });
}
