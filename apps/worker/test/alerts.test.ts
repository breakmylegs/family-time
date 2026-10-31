import { completions, people, pushSubscriptions, requests, settings, tasks } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceAlert, familyAlert, sendDeviceAlerts, sendFamilyAlert } from '../src/alerts.js';
import { jsonLog } from '../src/worker.js';
import { seedHome } from './seed.js';

let handle: TestDb;
const lines: string[] = [];
const log = jsonLog('worker', 'debug', (l) => void lines.push(l));
const vapid = { publicKey: 'BPublic', privateKey: 'private' };

beforeEach(async () => {
  handle = await testDb();
  lines.length = 0;
});
afterEach(async () => handle.close());

describe('device alerts', () => {
  it('say what happened in plain words and open Control for that child', () => {
    expect(deviceAlert('quiet', { label: "Ollie's iPad", childId: 'c1' })).toEqual({
      title: "Ollie's iPad has gone quiet",
      body: "It hasn't been in touch for 30 minutes, so Family time can't block apps on it. It's usually on mobile data or another network. Tap to see what to do.",
      path: '/?child=c1&help=device-gone-quiet',
    });
    expect(deviceAlert('not-confirmed', { label: "Ollie's iPad", childId: 'c1' })).toMatchObject({ title: "Ollie's iPad hasn't picked up a change", path: '/?child=c1' });
  });

  it('go to every owner and parent, not to carers', async () => {
    const s = await seedHome(handle.db);
    const [gran] = await handle.db.insert(people).values({ householdId: s.hh.id, displayName: 'Gran', role: 'carer' }).returning();
    await handle.db.insert(settings).values({ householdId: s.hh.id, key: 'public_origin', value: 'https://family.example.com' });
    await handle.db.insert(pushSubscriptions).values([
      { personId: s.mum.id, endpoint: 'https://web.push.apple.com/mum', p256dh: 'k', auth: 'a' },
      { personId: gran!.id, endpoint: 'https://web.push.apple.com/gran', p256dh: 'k', auth: 'a' },
    ]);
    const sent: { endpoint: string; payload: string }[] = [];
    const n = await sendDeviceAlerts(
      { db: handle.db, vapid, log, send: async (sub, payload) => (sent.push({ endpoint: sub.endpoint, payload }), { statusCode: 201 }) },
      'quiet',
      [s.ipad.id],
    );
    expect(n).toBe(1);
    expect(sent.map((x) => x.endpoint)).toEqual(['https://web.push.apple.com/mum']);
    expect(JSON.parse(sent[0]!.payload).notification).toMatchObject({
      title: "Ollie's iPad has gone quiet",
      navigate: `https://family.example.com/?child=${s.ollie.id}&help=device-gone-quiet`,
    });
  });

  it('wait, and say why, until the owner invite has set the public address', async () => {
    const s = await seedHome(handle.db);
    const n = await sendDeviceAlerts({ db: handle.db, vapid, log, send: async () => ({ statusCode: 201 }) }, 'not-confirmed', [s.ipad.id]);
    expect(n).toBe(0);
    expect(lines.some((l) => l.includes('alert_skipped'))).toBe(true);
  });

  it('for a job and a request, tell parents what and open Approvals', async () => {
    const s = await seedHome(handle.db);
    const [task] = await handle.db.insert(tasks).values({ householdId: s.hh.id, title: 'Emptied the dishwasher', rewardType: 'money', amount: 50, createdBy: s.mum.id }).returning();
    const [c] = await handle.db.insert(completions).values({ taskId: task!.id, childId: s.ollie.id, loggedAt: new Date('2026-10-26T17:05:00Z') }).returning();
    expect(await familyAlert(handle.db, { kind: 'completion', id: c!.id })).toMatchObject({
      to: 'parents',
      alert: { title: 'Ollie did a job', body: 'Emptied the dishwasher. Tap to approve it and send a note.', path: '/approvals' },
    });
    const [r] = await handle.db
      .insert(requests)
      .values({ childId: s.ollie.id, targetKind: 'service', targetId: s.roblox.id, startsAt: new Date('2026-10-26T19:00:00Z'), minutes: 30, askedAt: new Date('2026-10-26T18:20:00Z') })
      .returning();
    expect((await familyAlert(handle.db, { kind: 'request', id: r!.id }))?.alert.title).toBe('Ollie is asking for time');
    expect((await familyAlert(handle.db, { kind: 'request', id: r!.id }))?.alert.body).toMatch(/^Roblox at (Mon )?19:00 for 30 minutes\. Tap to answer\.$/);
  });

  it('about the ledger go to owners only', async () => {
    const s = await seedHome(handle.db);
    const [dad] = await handle.db.insert(people).values({ householdId: s.hh.id, displayName: 'Dad', role: 'parent' }).returning();
    await handle.db.insert(settings).values({ householdId: s.hh.id, key: 'public_origin', value: 'https://family.example.com' });
    await handle.db.insert(pushSubscriptions).values([
      { personId: s.mum.id, endpoint: 'https://web.push.apple.com/mum', p256dh: 'k', auth: 'a' },
      { personId: dad!.id, endpoint: 'https://web.push.apple.com/dad', p256dh: 'k', auth: 'a' },
    ]);
    const sent: string[] = [];
    await sendFamilyAlert(
      { db: handle.db, vapid, log, send: async (sub) => (sent.push(sub.endpoint), { statusCode: 201 }) },
      { kind: 'ledger', householdId: s.hh.id, problem: 'Entry 2 has been changed.' },
    );
    expect(sent).toEqual(['https://web.push.apple.com/mum']);
  });
});
