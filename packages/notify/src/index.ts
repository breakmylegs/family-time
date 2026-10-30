// Web Push for parents. VAPID keys come from secrets/vapid_private.pem (made by init.sh). Payloads
// use the Declarative Web Push shape (iOS 18.4 and later show it with no service worker code); our
// own service worker reads the same shape for every other browser.
import { people, pushSubscriptions, type Db } from '@family-time/db';
import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, inArray } from 'drizzle-orm';
import webpush from 'web-push';

/** The Postgres channel the worker NOTIFYs after each run and the api LISTENs on. The payload is a household id. */
export const CHANGE_CHANNEL = 'family_time_change';

export interface Vapid {
  /** base64url of the uncompressed P-256 public key: what the browser subscribes with. */
  publicKey: string;
  privateKey: string;
}

/** Reads a P-256 private key in PEM (`openssl ecparam -name prime256v1 -genkey`) as VAPID keys. */
export function vapidFromPem(pem: string): Vapid {
  const jwk = createPrivateKey(pem).export({ format: 'jwk' });
  if (jwk.crv !== 'P-256' || !jwk.x || !jwk.y || !jwk.d) throw new Error('The VAPID key must be a P-256 private key');
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  return { publicKey: Buffer.concat([Buffer.from([4]), x, y]).toString('base64url'), privateKey: jwk.d };
}

export function vapidFromFile(path: string | undefined): Vapid | undefined {
  if (!path) return undefined;
  try {
    return vapidFromPem(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export interface Alert {
  title: string;
  body: string;
  /** Path in the parent app the notification opens, for example `/?child=...`. */
  path: string;
}

/** The Declarative Web Push payload. One obvious action: open the screen it is about. */
export function declarativePayload(alert: Alert, origin: string): string {
  return JSON.stringify({
    web_push: 8030,
    notification: { title: alert.title, body: alert.body, navigate: new URL(alert.path, origin).toString(), lang: 'en-GB', dir: 'ltr' },
  });
}

export type Send = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<{ statusCode: number }>;

export interface PushDeps {
  db: Db;
  vapid: Vapid;
  /** The public origin, also the VAPID subject. */
  origin: string;
  /** Injected in tests; web-push otherwise. */
  send?: Send;
}

function sender(deps: PushDeps): Send {
  if (deps.send) return deps.send;
  return async (subscription, payload) =>
    webpush.sendNotification(subscription, payload, {
      vapidDetails: { subject: deps.origin, publicKey: deps.vapid.publicKey, privateKey: deps.vapid.privateKey },
      TTL: 3600,
      urgency: 'high',
    });
}

/**
 * Sends to every subscription of these people. A subscription the push service says is gone (404
 * or 410) is deleted; other failures are counted, and a subscription failing 10 times is dropped.
 */
export async function pushTo(deps: PushDeps, personIds: string[], alert: Alert): Promise<{ sent: number; failed: number }> {
  if (!personIds.length) return { sent: 0, failed: 0 };
  const subs = await deps.db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.personId, personIds));
  const send = sender(deps);
  const payload = declarativePayload(alert, deps.origin);
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      await deps.db.update(pushSubscriptions).set({ lastSentAt: new Date(), failures: 0 }).where(eq(pushSubscriptions.id, s.id));
      sent++;
    } catch (err) {
      failed++;
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410 || s.failures + 1 >= 10) {
        await deps.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
      } else {
        await deps.db.update(pushSubscriptions).set({ failures: s.failures + 1 }).where(eq(pushSubscriptions.id, s.id));
      }
    }
  }
  return { sent, failed };
}

/** Owners and parents of a household: the people who get control alerts. */
export async function parentsOf(db: Db, householdId: string): Promise<string[]> {
  const rows = await db
    .select({ id: people.id, role: people.role })
    .from(people)
    .where(and(eq(people.householdId, householdId), eq(people.active, true), inArray(people.role, ['owner', 'parent'])));
  return rows.map((r) => r.id);
}
