// Optional owner sign-in through Authentik with OIDC (brief Part 8). Off unless the owner sets the
// issuer and client id (`ft.sh sso-setup`) and puts the client secret in secrets/oidc_client_secret.
// Only an owner whose Authentik account has been linked, from Settings while signed in with a
// passkey, can sign in this way; passkeys keep working whatever happens here.
//
// The authorisation code flow with PKCE, state and nonce. The three are kept on the server for ten
// minutes, keyed by a random id in an HttpOnly cookie, so a code from someone else's browser is no
// use in this one. Every sign-in asks Authentik for a fresh one (prompt=login, max_age=0): a live
// Authentik session on a shared tablet must never become an owner session on its own, when the
// passkey beside it asks for Face ID every time. The ID token's signature is checked against the
// issuer's keys, not only trusted because it came over TLS.
import * as client from 'openid-client';
import { randomToken } from './tokens.js';

export const SETTING_OWNER_SSO = 'owner_sso';
export const OIDC_COOKIE = '__Host-ft_oidc';
export const OIDC_PENDING_MS = 10 * 60_000;
/** How old Authentik's own sign-in may be when it answers: it was asked for a fresh one. */
const FRESH_SIGN_IN_SECONDS = 300;
const MAX_PENDING = 200;

/** The household setting `ft.sh sso-setup` writes. */
export interface OwnerSso {
  issuer: string;
  clientId: string;
}

export interface Pending {
  state: string;
  nonce: string;
  verifier: string;
  /** Linking: the signed-in owner the Authentik account is for. Absent when signing in. */
  linkPersonId?: string;
  expires: number;
}

export class OidcError extends Error {}
/** No sign-in was started in this browser: nothing to audit, just someone calling the callback. */
export class NoPendingSignIn extends OidcError {}
/** Authentik could not be reached at all. */
export class OidcUnreachable extends OidcError {}

/**
 * What `people.oidc_subject` holds: the issuer and its subject together, so a link made with one
 * Authentik application never matches an account from another, or from a later issuer.
 */
export const subjectKey = (issuer: string, sub: string) => `${issuer}#${sub}`;

export class Oidc {
  private configs = new Map<string, Promise<client.Configuration>>();
  private pending = new Map<string, Pending>();

  constructor(
    private readonly clientSecret: string,
    /** Tests only: the fake provider is plain http. Real issuers must be https. */
    private readonly allowInsecure = false,
  ) {}

  private config(sso: OwnerSso): Promise<client.Configuration> {
    const key = `${sso.issuer} ${sso.clientId}`;
    let c = this.configs.get(key);
    if (!c) {
      c = client
        .discovery(new URL(sso.issuer), sso.clientId, this.clientSecret, undefined, { timeout: 10, ...(this.allowInsecure ? { execute: [client.allowInsecureRequests] } : {}) })
        .then((config) => {
          client.enableNonRepudiationChecks(config);
          return config;
        });
      // A failed discovery (Authentik restarting) is tried again next time, not remembered.
      c.catch(() => this.configs.delete(key));
      this.configs.set(key, c);
    }
    return c.catch((err: unknown) => {
      throw new OidcUnreachable(`Authentik could not be reached: ${(err as Error).message}`, { cause: err });
    });
  }

  /** The URL to send the browser to, and the cookie value that ties the answer to this browser. */
  async start(sso: OwnerSso, redirectUri: string, now: number, linkPersonId?: string): Promise<{ url: URL; cookie: string }> {
    const config = await this.config(sso);
    const verifier = client.randomPKCECodeVerifier();
    const p: Pending = { state: client.randomState(), nonce: client.randomNonce(), verifier, expires: now + OIDC_PENDING_MS, ...(linkPersonId ? { linkPersonId } : {}) };
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: 'openid profile',
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state: p.state,
      nonce: p.nonce,
      prompt: 'login',
      max_age: '0',
    });
    for (const [k, v] of this.pending) if (v.expires <= now) this.pending.delete(k);
    // Bounded. Sign-ins anyone can start make room by dropping the oldest sign-in, never a link an
    // owner has in progress, so a flood of starts cannot block linking.
    while (this.pending.size >= MAX_PENDING) {
      const oldest = [...this.pending].find(([, v]) => !v.linkPersonId)?.[0] ?? this.pending.keys().next().value!;
      this.pending.delete(oldest);
    }
    const cookie = randomToken();
    this.pending.set(cookie, p);
    return { url, cookie };
  }

  /** Exchanges the code for a verified ID token's subject and name. Each cookie works once. */
  async finish(sso: OwnerSso, currentUrl: URL, cookie: string | undefined, now: number): Promise<{ subject: string; username: string | null; linkPersonId?: string }> {
    const p = cookie ? this.pending.get(cookie) : undefined;
    if (cookie) this.pending.delete(cookie);
    if (!p) throw new NoPendingSignIn('no sign-in was started in this browser');
    if (p.expires <= now) throw new OidcError('the sign-in took more than ten minutes');
    let tokens;
    try {
      tokens = await client.authorizationCodeGrant(await this.config(sso), currentUrl, {
        pkceCodeVerifier: p.verifier,
        expectedState: p.state,
        expectedNonce: p.nonce,
        idTokenExpected: true,
        maxAge: FRESH_SIGN_IN_SECONDS,
      });
    } catch (err) {
      if (err instanceof OidcUnreachable) throw err;
      throw new OidcError((err as Error).message, { cause: err });
    }
    const claims = tokens.claims();
    if (!claims?.sub) throw new OidcError('the ID token has no subject');
    const username = typeof claims.preferred_username === 'string' ? claims.preferred_username.slice(0, 100) : null;
    return { subject: subjectKey(sso.issuer, claims.sub), username, ...(p.linkPersonId ? { linkPersonId: p.linkPersonId } : {}) };
  }
}
