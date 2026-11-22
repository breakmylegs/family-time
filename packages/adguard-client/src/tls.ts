// Trusting an owner's self-signed certificate for AdGuard only (ADR 0022). Node's own fetch can only
// add a certificate for every connection in the process (NODE_EXTRA_CA_CERTS), which would let
// whoever holds that certificate's key stand in for any server the api or worker talks to: the
// sign-in service, AI providers, push services. This fetch is given to the AdGuard client alone.
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

/** A fetch, for the AdGuard client only, that trusts `ca` as well as the usual certificates. */
export function fetchTrusting(ca: string): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== 'https:') throw new Error('A trusted certificate is only for an https AdGuard address.');
    return new Promise<Response>((resolve, reject) => {
      const req = request(
        url,
        {
          method: init?.method ?? 'GET',
          headers: (init?.headers ?? {}) as Record<string, string>,
          ca,
          ...(init?.signal ? { signal: init.signal } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('error', reject);
          res.on('end', () => {
            const status = res.statusCode ?? 502;
            const body = Buffer.concat(chunks);
            // A Response cannot carry a body with these statuses.
            const empty = status === 204 || status === 304 || body.length === 0;
            resolve(new Response(empty ? null : body, { status, headers: { 'content-type': String(res.headers['content-type'] ?? '') } }));
          });
        },
      );
      req.on('error', reject);
      if (typeof init?.body === 'string') req.write(init.body);
      req.end();
    });
  }) as typeof fetch;
}

/**
 * The fetch the AdGuard client should use: one that trusts the certificate in `caFile` when the
 * owner opted in (ADGUARD_CA_FILE, set only with ADGUARD_CA=1), or undefined for Node's own fetch.
 */
export function adguardFetch(caFile: string | undefined): typeof fetch | undefined {
  if (!caFile) return undefined;
  const ca = readFileSync(caFile, 'utf8');
  if (!ca.includes('BEGIN CERTIFICATE')) throw new Error(`${caFile} holds no certificate. Put AdGuard's certificate in secrets/adguard_ca.pem, or set ADGUARD_CA=0.`);
  return fetchTrusting(ca);
}
