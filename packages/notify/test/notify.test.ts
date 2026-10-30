import { households, people, pushSubscriptions } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { declarativePayload, parentsOf, pushTo, vapidFromPem, type Send } from '../src/index.js';

let handle: TestDb | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

const pem = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'sec1', format: 'pem' }).toString();

describe('VAPID keys', () => {
  it('come from the PEM init.sh makes, as the browser expects them', () => {
    const v = vapidFromPem(pem);
    expect(Buffer.from(v.publicKey, 'base64url')).toHaveLength(65);
    expect(Buffer.from(v.publicKey, 'base64url')[0]).toBe(4);
    expect(Buffer.from(v.privateKey, 'base64url')).toHaveLength(32);
  });

  it('refuse a key on the wrong curve', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ type: 'sec1', format: 'pem' }).toString();
    expect(() => vapidFromPem(other)).toThrow(/P-256/);
  });
});

describe('payloads', () => {
  it('use the Declarative Web Push shape with one place to go', () => {
    const p = JSON.parse(declarativePayload({ title: "Ollie's iPad has gone quiet", body: 'It has not used home internet for 30 minutes.', path: '/?child=abc' }, 'https://family.example.com'));
    expect(p).toEqual({
      web_push: 8030,
      notification: { title: "Ollie's iPad has gone quiet", body: 'It has not used home internet for 30 minutes.', navigate: 'https://family.example.com/?child=abc', lang: 'en-GB', dir: 'ltr' },
    });
  });
});

describe('sending', () => {
  it('reaches owners and parents, drops subscriptions the browser has gone from, and counts other failures', async () => {
    handle = await testDb();
    const db = handle.db;
    const [hh] = await db.insert(households).values({ name: 'Test' }).returning();
    const [mum] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Mum', role: 'owner' }).returning();
    const [dad] = await db.insert(people).values({ householdId: hh!.id, displayName: 'Dad', role: 'parent' }).returning();
    await db.insert(people).values({ householdId: hh!.id, displayName: 'Gran', role: 'carer' });
    await db.insert(pushSubscriptions).values([
      { personId: mum!.id, endpoint: 'https://fcm.googleapis.com/fcm/send/ok', p256dh: 'k', auth: 'a' },
      { personId: dad!.id, endpoint: 'https://fcm.googleapis.com/fcm/send/gone', p256dh: 'k', auth: 'a' },
      { personId: dad!.id, endpoint: 'https://fcm.googleapis.com/fcm/send/flaky', p256dh: 'k', auth: 'a' },
      // Written some other way, around the api's check: never sent to, and removed.
      { personId: mum!.id, endpoint: 'https://10.0.0.1%2efcm.googleapis.com/fcm/send/x', p256dh: 'k', auth: 'a' },
    ]);
    const parents = await parentsOf(db, hh!.id);
    expect(parents.sort()).toEqual([mum!.id, dad!.id].sort());

    const delivered: string[] = [];
    const send: Send = async (sub) => {
      if (sub.endpoint.endsWith('gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('flaky')) throw Object.assign(new Error('busy'), { statusCode: 503 });
      delivered.push(sub.endpoint);
      return { statusCode: 201 };
    };
    const result = await pushTo({ db, vapid: vapidFromPem(pem), origin: 'https://family.example.com', send }, parents, { title: 't', body: 'b', path: '/' });
    expect(result).toEqual({ sent: 1, failed: 3 });
    expect(delivered).toEqual(['https://fcm.googleapis.com/fcm/send/ok']);
    const left = await db.select().from(pushSubscriptions);
    expect(left.map((s) => [s.endpoint, s.failures]).sort()).toEqual([
      ['https://fcm.googleapis.com/fcm/send/flaky', 1],
      ['https://fcm.googleapis.com/fcm/send/ok', 0],
    ]);
  });
});
