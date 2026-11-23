// Owner sign-in through the household's sign-in service, Authentik or Authelia (brief Part 8,
// ADR 0023), against a fake OpenID provider that signs real
// RS256 ID tokens and checks the PKCE verifier. The tests show a forged or stale token is refused,
// so the signature, audience, auth_time, nonce and state are really checked.
import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { people, sessions } from '@family-time/db';
import { AuthState } from '@family-time/schemas';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { Oidc, SETTING_OWNER_SSO } from '../src/auth/oidc.js';
import { ssoSetup } from '../src/cli/sso.js';
import { setSetting } from '../src/settings.js';
import { seedHousehold, seedPerson, signedIn } from './accounts.js';
import { harness, type Harness } from './helpers.js';

const CLIENT_ID = 'family-time';
/** Ways a provider, or someone in the middle, could get a token wrong. */
interface Trick {
  nonce?: string;
  aud?: string;
  otherKey?: boolean;
  signedInSecondsAgo?: number;
}
const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url');

/** A small OpenID provider: discovery, keys, and a token endpoint that answers for codes the test hands out. */
async function fakeProvider() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'k1';
  const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const codes = new Map<string, { sub: string; nonce: string; challenge: string; trick: Trick }>();
  let base = '';
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, base);
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const issuer = `${base}/application/o/family-time/`;
    if (url.pathname === '/application/o/family-time/.well-known/openid-configuration') {
      return json({
        issuer,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.pathname === '/jwks') return json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] });
    if (url.pathname === '/token' && req.method === 'POST') {
      // client_secret_basic, as Authelia's example client is set up: the secret in the header only,
      // each half form-encoded before base64 (RFC 6749 2.3.1), decoded here as a real provider does.
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const [id, secret] = basic ? Buffer.from(basic, 'base64').toString().split(':').map((p) => decodeURIComponent(p.replace(/\+/g, ' '))) : [];
      if (id !== CLIENT_ID || secret !== 'client-secret') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid_client' }));
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const grant = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        // PKCE: the verifier must hash to the challenge sent at the start.
        const verifierOk = grant && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === grant.challenge;
        if (!grant || !verifierOk) {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid_grant' }));
        }
        const now = Math.floor(Date.now() / 1000);
        const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
        const t = grant.trick;
        const claims = b64(
          JSON.stringify({
            iss: issuer,
            aud: t.aud ?? CLIENT_ID,
            sub: grant.sub,
            nonce: t.nonce ?? grant.nonce,
            iat: now,
            exp: now + 300,
            auth_time: now - (t.signedInSecondsAgo ?? 5),
            preferred_username: grant.sub.replace('authentik-', ''),
          }),
        );
        const sig = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(t.otherKey ? stranger : privateKey).toString('base64url');
        json({ access_token: randomUUID(), token_type: 'Bearer', expires_in: 300, id_token: `${head}.${claims}.${sig}` });
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    issuer: `${base}/application/o/family-time/`,
    /** What Authentik does after the person signs in: a code for this authorisation URL's nonce. */
    approve(authorizationUrl: string, sub: string, trick: Trick = {}) {
      const u = new URL(authorizationUrl);
      // Family time always asks for a fresh sign-in, never a silent one.
      expect(u.searchParams.get('prompt')).toBe('login');
      expect(u.searchParams.get('max_age')).toBe('0');
      const code = randomUUID();
      codes.set(code, { sub, nonce: u.searchParams.get('nonce')!, challenge: u.searchParams.get('code_challenge')!, trick });
      return { code, state: u.searchParams.get('state')! };
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let h: Harness | undefined;
let op: Awaited<ReturnType<typeof fakeProvider>> | undefined;
afterEach(async () => {
  await h?.close();
  await op?.close();
  h = undefined;
  op = undefined;
});

async function setup() {
  op = await fakeProvider();
  h = await harness({ oidc: new Oidc('client-secret', true) });
  const db = h.handle.db;
  const home = await seedHousehold(db);
  const mum = await seedPerson(db, home, 'owner', 'Mum');
  const dad = await seedPerson(db, home, 'parent', 'Dad');
  await setSetting(db, home, SETTING_OWNER_SSO, { issuer: op.issuer, clientId: CLIENT_ID });
  return { app: h.app, db, mum, dad, headers: { mum: await signedIn(db, mum), dad: await signedIn(db, dad) } };
}

/** Links Mum's Authentik account, as Settings does: her session goes along to Authentik and back. */
async function linkMum(s: Awaited<ReturnType<typeof setup>>) {
  const link = await s.app.inject({ method: 'POST', url: '/api/auth/oidc/link', headers: s.headers.mum });
  const pending = cookieFrom(link.headers['set-cookie'], '__Host-ft_oidc')!;
  const { code, state } = op!.approve((link.json() as { url: string }).url, 'authentik-mum');
  return s.app.inject({ url: `/api/auth/oidc/callback?code=${code}&state=${state}`, headers: { cookie: `${s.headers.mum.cookie}; ${pending}` } });
}

const cookieFrom = (setCookie: string | string[] | undefined, name: string) => {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const found = all.find((c) => c.startsWith(`${name}=`));
  return found ? found.split(';')[0]! : undefined;
};

describe('owner sign-in through a sign-in service', () => {
  it('links the signed-in owner, then signs her in, and offers the button only once linked', async () => {
    const s = await setup();
    expect(AuthState.parse((await s.app.inject({ url: '/api/auth/state' })).json()).sso).toBe(false);
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/oidc/link', headers: s.headers.dad })).statusCode).toBe(403);

    const linked = await linkMum(s);
    expect(linked.statusCode).toBe(303);
    expect(linked.headers.location).toBe('/settings?sso=linked');
    // The issuer and the subject together.
    expect((await s.db.select({ sub: people.oidcSubject }).from(people).where(eq(people.id, s.mum)))[0]!.sub).toBe(`${op!.issuer}#authentik-mum`);
    expect(AuthState.parse((await s.app.inject({ url: '/api/auth/state' })).json()).sso).toBe(true);

    const start = await s.app.inject({ url: '/api/auth/oidc/start' });
    expect(start.statusCode).toBe(303);
    const again = op!.approve(start.headers.location!, 'authentik-mum');
    const signIn = await s.app.inject({ url: `/api/auth/oidc/callback?code=${again.code}&state=${again.state}`, headers: { cookie: cookieFrom(start.headers['set-cookie'], '__Host-ft_oidc')! } });
    expect(signIn.headers.location).toBe('/');
    const session = cookieFrom(signIn.headers['set-cookie'], '__Host-ft_session');
    expect(session).toBeDefined();
    expect(AuthState.parse((await s.app.inject({ url: '/api/auth/state', headers: { cookie: session! } })).json()).me).toMatchObject({ displayName: 'Mum', role: 'owner' });
  });

  it('refuses a code from another browser, a code used twice, a forged or stale token, and an account nobody linked', async () => {
    const s = await setup();
    await linkMum(s);
    const start = async () => {
      const r = await s.app.inject({ url: '/api/auth/oidc/start' });
      return { url: r.headers.location!, cookie: cookieFrom(r.headers['set-cookie'], '__Host-ft_oidc')! };
    };
    // No cookie: the answer was meant for another browser.
    const a = await start();
    const ga = op!.approve(a.url, 'authentik-mum');
    expect((await s.app.inject({ url: `/api/auth/oidc/callback?code=${ga.code}&state=${ga.state}` })).headers.location).toBe('/?sso=failed');
    // A token for Mum's account that is wrong in one way each: none of them signs her in.
    for (const [trick, said] of [
      [{ nonce: 'someone-elses-nonce' }, 'failed'],
      [{ otherKey: true }, 'failed'],
      [{ aud: 'another-app' }, 'failed'],
      // A provider that reused an old sign-in: said plainly, so nobody tries again in a loop.
      [{ signedInSecondsAgo: 3600 }, 'stale'],
    ] satisfies [Trick, string][]) {
      const b = await start();
      const gb = op!.approve(b.url, 'authentik-mum', trick);
      const r = await s.app.inject({ url: `/api/auth/oidc/callback?code=${gb.code}&state=${gb.state}`, headers: { cookie: b.cookie } });
      expect(r.headers.location, JSON.stringify(trick)).toBe(`/?sso=${said}`);
      expect(cookieFrom(r.headers['set-cookie'], '__Host-ft_session'), JSON.stringify(trick)).toBeUndefined();
    }
    // A verified Authentik account that is not linked to an owner.
    const c = await start();
    const gc = op!.approve(c.url, 'authentik-stranger');
    const stranger = await s.app.inject({ url: `/api/auth/oidc/callback?code=${gc.code}&state=${gc.state}`, headers: { cookie: c.cookie } });
    expect(stranger.headers.location).toBe('/?sso=unknown');
    expect(cookieFrom(stranger.headers['set-cookie'], '__Host-ft_session')).toBeUndefined();
    // The same cookie and code again.
    expect((await s.app.inject({ url: `/api/auth/oidc/callback?code=${gc.code}&state=${gc.state}`, headers: { cookie: c.cookie } })).headers.location).toBe('/?sso=failed');
  });

  it('links only for the owner who started it, and unlinking signs her out elsewhere', async () => {
    const s = await setup();
    // Mum starts a link, then someone else finishes it in that browser without her session.
    const link = await s.app.inject({ method: 'POST', url: '/api/auth/oidc/link', headers: s.headers.mum });
    const g = op!.approve((link.json() as { url: string }).url, 'authentik-someone');
    const other = await s.app.inject({ url: `/api/auth/oidc/callback?code=${g.code}&state=${g.state}`, headers: { cookie: cookieFrom(link.headers['set-cookie'], '__Host-ft_oidc')! } });
    expect(other.headers.location).toBe('/settings?sso=failed');
    expect((await s.db.select({ sub: people.oidcSubject }).from(people).where(eq(people.id, s.mum)))[0]!.sub).toBeNull();

    await linkMum(s);
    const elsewhere = await signedIn(s.db, s.mum);
    expect((await s.app.inject({ method: 'POST', url: '/api/auth/oidc/unlink', headers: s.headers.mum })).statusCode).toBe(200);
    expect((await s.app.inject({ url: '/api/me', headers: { cookie: elsewhere.cookie } })).statusCode).toBe(401);
    expect((await s.app.inject({ url: '/api/me', headers: { cookie: s.headers.mum.cookie } })).statusCode).toBe(200);
    expect((await s.db.select({ sub: people.oidcSubject }).from(people).where(eq(people.id, s.mum)))[0]!.sub).toBeNull();
  });

  it('lets a linked owner become a parent, which clears the link', async () => {
    const s = await setup();
    await linkMum(s);
    const second = await seedPerson(s.db, (await s.db.select({ hh: people.householdId }).from(people).where(eq(people.id, s.mum)))[0]!.hh, 'owner', 'Gran');
    const asGran = await signedIn(s.db, second);
    const r = await s.app.inject({ method: 'PATCH', url: `/api/people/${s.mum}`, headers: asGran, payload: { role: 'parent' } });
    expect(r.statusCode).toBe(200);
    expect((await s.db.select({ sub: people.oidcSubject, role: people.role }).from(people).where(eq(people.id, s.mum)))[0]).toEqual({ sub: null, role: 'parent' });
    expect(await s.db.select().from(sessions).where(eq(sessions.personId, s.mum))).toEqual([]);
  });

  it('is off without the client secret, and the command line needs an https issuer', async () => {
    h = await harness();
    const db = h.handle.db;
    const home = await seedHousehold(db);
    await seedPerson(db, home, 'owner', 'Mum');
    expect((await h.app.inject({ url: '/api/auth/oidc/start' })).headers.location).toBe('/?sso=off');
    await expect(ssoSetup(db, { issuer: 'http://auth.example.com/', clientId: CLIENT_ID })).rejects.toThrow(/https/);
    expect(await ssoSetup(db, { issuer: 'https://auth.example.com/application/o/family-time/', clientId: CLIENT_ID })).toMatch(/redirect URI must be http:\/\/localhost:5174\/api\/auth\/oidc\/callback/);
    expect(await ssoSetup(db, { off: true })).toMatch(/off/);
  });

  it('shows the name the owner gave the sign-in service, keeps links when only the name changes, and sends a stale link back to Settings', async () => {
    const s = await setup();
    expect((await s.app.inject({ url: '/api/auth/oidc', headers: s.headers.mum })).json()).toMatchObject({ name: 'your sign-in service' });
    await linkMum(s);
    expect(await ssoSetup(s.db, { name: 'Authelia' })).toMatch(/Sign in with Authelia/);
    await expect(ssoSetup(s.db, { name: '<script>' })).rejects.toThrow(/--name/);
    // Only the name changed: Mum's link and her session are untouched.
    expect((await s.db.select({ sub: people.oidcSubject }).from(people).where(eq(people.id, s.mum)))[0]!.sub).toBe(`${op!.issuer}#authentik-mum`);
    expect(AuthState.parse((await s.app.inject({ url: '/api/auth/state' })).json())).toMatchObject({ sso: true, ssoName: 'Authelia' });
    expect((await s.app.inject({ url: '/api/auth/oidc', headers: s.headers.mum })).json()).toMatchObject({ name: 'Authelia', linked: true });

    const link = await s.app.inject({ method: 'POST', url: '/api/auth/oidc/link', headers: s.headers.mum });
    const g = op!.approve((link.json() as { url: string }).url, 'authentik-mum', { signedInSecondsAgo: 3600 });
    const r = await s.app.inject({ url: `/api/auth/oidc/callback?code=${g.code}&state=${g.state}`, headers: { cookie: `${s.headers.mum.cookie}; ${cookieFrom(link.headers['set-cookie'], '__Host-ft_oidc')!}` } });
    expect(r.headers.location).toBe('/settings?sso=stale');
  });
});
