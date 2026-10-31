// OAuth 2.1 for MCP clients (ADR 0016): this platform is the authorisation server. Clients are
// public and identify themselves with a Client ID Metadata Document (an https URL). A parent signs
// in with their passkey session and consents; the owner allows each app once. Codes are single use
// with PKCE S256; access tokens last an hour; refresh tokens are used once and replaced, and a
// reused one ends the whole sign-in. Only hashes of codes and tokens are stored.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup, type LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { oauthClients, oauthCodes, oauthTokens, people, type Db } from '@family-time/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { can } from '../auth/capabilities.js';

export const SCOPES = ['read', 'propose'] as const;
export type Scope = (typeof SCOPES)[number];

export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 86_400_000;

const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** The client's own description of itself, fetched from its client_id URL. */
export const ClientMetadata = z.object({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(100),
  redirect_uris: z.array(z.url()).min(1).max(10),
  client_uri: z.url().optional(),
  token_endpoint_auth_method: z.enum(['none']).optional(),
});
export type ClientMetadata = z.infer<typeof ClientMetadata>;

export type FetchClientMetadata = (url: string) => Promise<unknown>;

/** True for addresses that are not on the public internet: the home network, loopback and the like. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  // An IPv4 address inside IPv6, dotted (::ffff:10.0.0.1) or in hex (::ffff:a00:1): check the IPv4 one.
  const mapped = /^::(?:ffff:)?(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(v6);
  if (mapped) {
    if (mapped[1]) return privateAddress(mapped[1]);
    const hi = parseInt(mapped[2]!, 16);
    const lo = parseInt(mapped[3]!, 16);
    return privateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  // NAT64 and 6to4 also carry IPv4 addresses; refuse them rather than unpick them.
  if (v6.startsWith('64:ff9b:') || v6.startsWith('2002:')) return true;
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

const MAX_DOCUMENT_BYTES = 16_384;

/**
 * The connection's own name lookup, which refuses any address not on the public internet. The
 * address checked is the address connected to, so a name cannot be switched in between.
 */
const publicOnly: LookupFunction = (host, options, done) => {
  lookup(host, { all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return done(err, '', 4);
    if (!addresses.length || addresses.some((a) => privateAddress(a.address))) return done(new OAuthError('invalid_client', "The app's address is not on the public internet."), '', 4);
    if (options.all) return (done as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    done(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/**
 * Fetches a client's metadata document: https only, public addresses only (so a client_id can never
 * make the server read something on the home network), no redirects, five seconds, 16 KB at most,
 * counted as it arrives so a huge answer is cut off, not read.
 */
export const fetchClientMetadata: FetchClientMetadata = (url) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const fail = (message: string) => reject(new OAuthError('invalid_client', message));
    if (u.protocol !== 'https:') return fail('The app must publish its details over https.');
    const req = request(u, { method: 'GET', headers: { accept: 'application/json' }, lookup: publicOnly }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return fail(`The app's details could not be read (${res.statusCode}).`);
      }
      if (Number(res.headers['content-length'] ?? 0) > MAX_DOCUMENT_BYTES) {
        req.destroy();
        return fail("The app's details are too long.");
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_DOCUMENT_BYTES) {
          req.destroy();
          fail("The app's details are too long.");
        } else chunks.push(chunk);
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
        } catch {
          fail("The app's details are not in the expected form.");
        }
      });
      res.on('error', () => fail("The app's details could not be read."));
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout')), 5000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (err) => (err instanceof OAuthError ? reject(err) : fail("The app's details could not be read.")));
    req.end();
  });

/** A client_id must be an https URL with a path, no fragment, no credentials (CIMD). Localhost is for tests. */
export function checkClientId(clientId: string, allowHttpLocalhost = false) {
  const u = new URL(clientId);
  const local = allowHttpLocalhost && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if ((u.protocol !== 'https:' && !local) || u.pathname === '/' || u.hash || u.username || u.password) {
    throw new OAuthError('invalid_client', 'The app gave a client_id that is not a proper https address.');
  }
}

/** Space-separated scopes, each one we know. Defaults to read. */
export function parseScopes(scope: string | undefined): Scope[] {
  const asked = (scope ?? 'read').split(' ').filter(Boolean);
  if (!asked.length) return ['read'];
  for (const s of asked) if (!(SCOPES as readonly string[]).includes(s)) throw new OAuthError('invalid_scope', `${s} is not a scope here. Ask for read, or read and propose.`);
  return [...new Set(asked)] as Scope[];
}

/** Reads and checks the client's document, and records or refreshes it. New clients start not allowed. */
export async function registerClient(db: Db, householdId: string, clientId: string, fetcher: FetchClientMetadata, now: Date) {
  const doc = ClientMetadata.safeParse(await fetcher(clientId).catch((err: unknown) => {
    if (err instanceof OAuthError) throw err;
    throw new OAuthError('invalid_client', "The app's details could not be read.");
  }));
  if (!doc.success) throw new OAuthError('invalid_client', "The app's details are not in the expected form.");
  if (doc.data.client_id !== clientId) throw new OAuthError('invalid_client', "The app's details are for a different app.");
  const existing = (await db.select().from(oauthClients).where(and(eq(oauthClients.householdId, householdId), eq(oauthClients.clientUri, clientId))))[0];
  if (existing?.revokedAt) {
    // Removed by the owner: it can come back, but only by being allowed again.
    const [row] = await db
      .update(oauthClients)
      .set({ name: doc.data.client_name, redirectUris: doc.data.redirect_uris, allowed: false, revokedAt: null, scopes: ['read'] })
      .where(eq(oauthClients.id, existing.id))
      .returning();
    return row!;
  }
  if (existing) {
    // An app the owner allowed keeps the name the owner saw. If its return addresses change, it
    // needs allowing again, so an app cannot quietly start sending sign-ins somewhere new.
    const before = [...(existing.redirectUris as string[])].sort().join(' ');
    const after = [...doc.data.redirect_uris].sort().join(' ');
    if (existing.allowed && before === after) return existing;
    const [row] = await db
      .update(oauthClients)
      .set({ name: existing.allowed ? existing.name : doc.data.client_name, redirectUris: doc.data.redirect_uris, ...(existing.allowed ? { allowed: false } : {}) })
      .where(eq(oauthClients.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(oauthClients)
    .values({ householdId, clientUri: clientId, name: doc.data.client_name, redirectUris: doc.data.redirect_uris, scopes: ['read'], allowed: false, createdAt: now })
    .returning();
  return row!;
}

/** Makes a single-use code for a parent's consent. Returns the code itself; only its hash is kept. */
export async function issueCode(
  db: Db,
  input: { clientRowId: string; personId: string; redirectUri: string; challenge: string; scopes: Scope[]; resource: string | null },
  now: Date,
): Promise<string> {
  const code = token('ftc');
  await db.insert(oauthCodes).values({
    codeHash: hash(code),
    clientId: input.clientRowId,
    personId: input.personId,
    redirectUri: input.redirectUri,
    challenge: input.challenge,
    scope: input.scopes.join(' '),
    resource: input.resource,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
  return code;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issuePair(db: Db, input: { family: string; clientRowId: string; personId: string; scope: string }, now: Date): Promise<TokenResponse> {
  const access = token('fta');
  const refresh = token('ftr');
  await db.insert(oauthTokens).values([
    { tokenHash: hash(access), kind: 'access', family: input.family, clientId: input.clientRowId, personId: input.personId, scope: input.scope, expiresAt: new Date(now.getTime() + ACCESS_TTL_MS), createdAt: now },
    { tokenHash: hash(refresh), kind: 'refresh', family: input.family, clientId: input.clientRowId, personId: input.personId, scope: input.scope, expiresAt: new Date(now.getTime() + REFRESH_TTL_MS), createdAt: now },
  ]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: input.scope };
}

async function clientUsable(db: Db, clientRowId: string, clientId: string) {
  const c = (await db.select().from(oauthClients).where(eq(oauthClients.id, clientRowId)))[0];
  if (!c || c.clientUri !== clientId) throw new OAuthError('invalid_grant', 'That code or token was not issued to this app.');
  if (!c.allowed || c.revokedAt) throw new OAuthError('invalid_client', 'The owner has not allowed this app, or has removed it.', 401);
  return c;
}

async function personUsable(db: Db, personId: string) {
  const p = (await db.select().from(people).where(eq(people.id, personId)))[0];
  if (!p?.active || !can(p.role, 'control.change')) throw new OAuthError('invalid_grant', 'The person who signed in can no longer connect apps.');
  return p;
}

/** The authorisation code grant, with the PKCE check. */
export async function exchangeCode(db: Db, input: { code: string; clientId: string; redirectUri: string; verifier: string; resource?: string }, now: Date): Promise<TokenResponse> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) throw new OAuthError('invalid_grant', 'The code_verifier is not in the right form.');
  const codeHash = hash(input.code);
  // Claim the code first, so it can only ever be used once, even by two requests at the same moment.
  const [c] = await db
    .update(oauthCodes)
    .set({ usedAt: now })
    .where(and(eq(oauthCodes.codeHash, codeHash), isNull(oauthCodes.usedAt)))
    .returning();
  if (!c || c.expiresAt <= now) throw new OAuthError('invalid_grant', 'That code has expired or has been used. Sign in again.');
  await clientUsable(db, c.clientId, input.clientId);
  if (c.redirectUri !== input.redirectUri) throw new OAuthError('invalid_grant', 'The redirect_uri does not match.');
  if (input.resource && c.resource && input.resource !== c.resource) throw new OAuthError('invalid_target', 'The resource does not match.');
  const expected = Buffer.from(c.challenge);
  const actual = Buffer.from(createHash('sha256').update(input.verifier).digest('base64url'));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new OAuthError('invalid_grant', 'The code_verifier does not match.');
  await personUsable(db, c.personId);
  return issuePair(db, { family: randomUUID(), clientRowId: c.clientId, personId: c.personId, scope: c.scope }, now);
}

/** The refresh grant. A refresh token works once; a second use ends every token from that sign-in. */
export async function refresh(db: Db, input: { refreshToken: string; clientId: string; scope?: string }, now: Date): Promise<TokenResponse> {
  const t = (await db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, hash(input.refreshToken))))[0];
  if (!t || t.kind !== 'refresh') throw new OAuthError('invalid_grant', 'That refresh token is not known. Sign in again.');
  if (t.usedAt || t.revokedAt) {
    await db.update(oauthTokens).set({ revokedAt: now }).where(and(eq(oauthTokens.family, t.family), isNull(oauthTokens.revokedAt)));
    throw new OAuthError('invalid_grant', 'That refresh token has already been used, so this sign-in has ended. Sign in again.');
  }
  if (t.expiresAt <= now) throw new OAuthError('invalid_grant', 'That refresh token has expired. Sign in again.');
  const claimed = await db.update(oauthTokens).set({ usedAt: now }).where(and(eq(oauthTokens.id, t.id), isNull(oauthTokens.usedAt))).returning({ id: oauthTokens.id });
  if (!claimed.length) {
    await db.update(oauthTokens).set({ revokedAt: now }).where(eq(oauthTokens.family, t.family));
    throw new OAuthError('invalid_grant', 'That refresh token has already been used, so this sign-in has ended. Sign in again.');
  }
  const client = await clientUsable(db, t.clientId, input.clientId);
  await personUsable(db, t.personId);
  // A refresh can narrow the scope, never widen it; and never past what the owner allows now.
  const held = t.scope.split(' ');
  const allowed = client.scopes as string[];
  const asked = input.scope ? parseScopes(input.scope) : (held as Scope[]);
  if (asked.some((s) => !held.includes(s))) throw new OAuthError('invalid_scope', 'A refresh cannot add scopes. Sign in again to ask for more.');
  const scope = asked.filter((s) => allowed.includes(s)).join(' ');
  if (!scope) throw new OAuthError('invalid_scope', 'The owner no longer allows this app what it had. Sign in again.');
  return issuePair(db, { family: t.family, clientRowId: t.clientId, personId: t.personId, scope }, now);
}

export interface Bearer {
  householdId: string;
  personId: string;
  clientRowId: string;
  clientName: string;
  scopes: Scope[];
  expiresAt: Date;
}

/** Checks an access token on every MCP request: the token, the app, and the person behind it. */
export async function verifyAccess(db: Db, raw: string, now: Date): Promise<Bearer | null> {
  if (!/^fta_[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const row = (
    await db
      .select({ t: oauthTokens, c: oauthClients, p: people })
      .from(oauthTokens)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
      .innerJoin(people, eq(people.id, oauthTokens.personId))
      .where(eq(oauthTokens.tokenHash, hash(raw)))
  )[0];
  if (!row || row.t.kind !== 'access' || row.t.revokedAt || row.t.expiresAt <= now) return null;
  if (!row.c.allowed || row.c.revokedAt) return null;
  if (!row.p.active || !can(row.p.role, 'control.change')) return null;
  // What the owner allows today wins over what the token was given.
  const allowed = row.c.scopes as string[];
  const scopes = row.t.scope.split(' ').filter((s): s is Scope => allowed.includes(s) && (SCOPES as readonly string[]).includes(s));
  if (!scopes.length) return null;
  if (!row.c.lastUsedAt || now.getTime() - row.c.lastUsedAt.getTime() > 60_000) await db.update(oauthClients).set({ lastUsedAt: now }).where(eq(oauthClients.id, row.c.id));
  return { householdId: row.c.householdId, personId: row.p.id, clientRowId: row.c.id, clientName: row.c.name, scopes, expiresAt: row.t.expiresAt };
}
