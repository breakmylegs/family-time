import { auditEvents, grants, helpFeedback, overrides, policies, pushSubscriptions, schedules, serviceGroupMembers, serviceGroups, services, sessionEndings, type Db } from '@family-time/db';
import { ChildStatus, HistoryEntry } from '@family-time/schemas';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { seedHousehold, seedPerson, signedIn } from './accounts.js';
import { harness, NOW, type Harness } from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const min = (n: number) => n * 60_000;

/** A harness on the mock's clock (Monday 26 October 2026, 18:32 London) that the test can move. */
async function setup(options: { vapidPublicKey?: string } = {}) {
  let at = NOW;
  h = await harness({ clock: () => at, ...options });
  const db = h.handle.db;
  const s = await seed(db);
  return { ...s, db, app: h.app, advance: (ms: number) => void (at = new Date(at.getTime() + ms)) };
}

async function seed(db: Db) {
  const hh = await seedHousehold(db);
  const owner = await seedPerson(db, hh, 'owner', 'Mum');
  const carer = await seedPerson(db, hh, 'carer', 'Gran');
  const child = await seedPerson(db, hh, 'child', 'Ollie');
  const [youtube] = await db.insert(services).values({ householdId: hh, name: 'YouTube', source: 'adguard', adguardId: 'youtube', domains: ['youtube.com'] }).returning();
  const [roblox] = await db.insert(services).values({ householdId: hh, name: 'Roblox', source: 'adguard', adguardId: 'roblox', domains: ['roblox.com'] }).returning();
  const [games] = await db.insert(serviceGroups).values({ householdId: hh, name: 'Games' }).returning();
  await db.insert(serviceGroupMembers).values({ groupId: games!.id, serviceId: roblox!.id });
  await db.insert(policies).values({ childId: child, groupId: games!.id });
  await db.insert(schedules).values({
    householdId: hh,
    name: 'School night',
    weekdays: [1, 2, 3, 4, 5],
    blocks: [
      { type: 'school', start: '08:30', end: '15:30' },
      { type: 'free', start: '15:30', end: '17:30' },
      { type: 'pause', start: '17:30', end: '18:15', label: 'Tea' },
      { type: 'free', start: '18:15', end: '19:30' },
      { type: 'wind-down', start: '19:30', end: '20:30' },
      { type: 'bed', start: '20:30', end: '07:00' },
    ],
  });
  return { hh, owner, carer, child, youtube: youtube!, roblox: roblox! };
}

describe('Control screen data', () => {
  it('sends the headline, the day and every duration with its real end time', async () => {
    const s = await setup();
    const status = ChildStatus.parse((await s.app.inject({ url: `/api/children/${s.child}/status`, headers: await signedIn(s.db, s.owner) })).json());
    expect(status.headline).toEqual({ lead: 'Free time now.', rest: 'Wind-down starts at 19:30.' });
    expect(status.child.pronouns).toBe('they');
    expect(status.day.map((b) => `${b.label} ${b.startLabel}`)).toEqual(['School 08:30', 'Free time 15:30', 'Tea 17:30', 'Free time 18:15', 'Wind-down 19:30', 'Bed 20:30']);
    expect(status.durations.allow.map((d) => [d.label, d.until, d.note ?? ''])).toEqual([
      ['For 30 minutes', 'until 19:02', ''],
      ['For 1 hour', 'until 19:32', 'Runs into wind-down'],
      ['Until bedtime', 'until 20:30', 'Overrides wind-down'],
      ['Until tomorrow', 'until Tue 07:00', 'Runs through bedtime'],
    ]);
    expect(status.durations.pause).toHaveLength(3);
    expect(status.pause).toBeNull();
    // Blocked through free time, wind-down and bed: no end worth showing.
    expect(status.services.map((x) => [x.name, x.untilLabel])).toEqual([
      ['Roblox', null],
      ['YouTube', null],
    ]);
    expect(status.services.every((x) => x.override === null && x.inPlannedTime === false)).toBe(true);
  });

  it('says who paused everything and until when', async () => {
    const s = await setup();
    const headers = await signedIn(s.db, s.carer);
    const res = await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers, payload: { target: { kind: 'everything' }, type: 'pause', duration: 'until-resume' } });
    const status = ChildStatus.parse(res.json());
    expect(status.headline).toEqual({ lead: 'Everything is paused', rest: 'until you resume. Gran started it.' });
    expect(status.pause).toMatchObject({ by: 'Gran', until: null });
  });
});

describe('Undo', () => {
  it('ends the Allow just made, once, and audits it', async () => {
    const s = await setup();
    const headers = await signedIn(s.db, s.owner);
    const made = ChildStatus.parse(
      (await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers, payload: { target: { kind: 'service', id: s.youtube.id }, type: 'allow', duration: '30m' } })).json(),
    );
    const yt = made.services.find((x) => x.name === 'YouTube')!;
    expect(yt.override?.type).toBe('allow');
    s.advance(5_000);
    const undo = await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides/${yt.override!.id}/end`, headers });
    expect(undo.statusCode).toBe(200);
    expect(ChildStatus.parse(undo.json()).services.find((x) => x.name === 'YouTube')).toMatchObject({ state: 'blocked', override: null });
    expect((await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides/${yt.override!.id}/end`, headers })).statusCode).toBe(409);
    expect(await s.db.select().from(auditEvents).where(eq(auditEvents.action, 'control.undo'))).toHaveLength(1);
  });

  it('lets a carer undo a Pause but not an Allow', async () => {
    const s = await setup();
    const owner = await signedIn(s.db, s.owner);
    const carer = await signedIn(s.db, s.carer);
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers: owner, payload: { target: { kind: 'service', id: s.youtube.id }, type: 'allow', duration: '30m' } });
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers: carer, payload: { target: { kind: 'everything' }, type: 'pause', duration: '30m' } });
    const rows = await s.db.select().from(overrides);
    const allow = rows.find((r) => r.type === 'allow')!;
    const pause = rows.find((r) => r.type === 'pause')!;
    expect((await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides/${allow.id}/end`, headers: carer })).statusCode).toBe(403);
    expect((await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides/${pause.id}/end`, headers: carer })).statusCode).toBe(200);
  });

  it('puts back what Normal ended, with the end first chosen, but not a minute later', async () => {
    const s = await setup();
    const headers = await signedIn(s.db, s.owner);
    const target = { kind: 'service', id: s.roblox.id };
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers, payload: { target, type: 'allow', duration: '1h' } });
    s.advance(min(5));
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/normal`, headers, payload: { target } });
    s.advance(3_000);
    const undo = await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/normal/undo`, headers, payload: { target } });
    expect(undo.statusCode).toBe(200);
    expect(ChildStatus.parse(undo.json()).services.find((x) => x.name === 'Roblox')).toMatchObject({ state: 'allowed', until: '2026-10-26T19:32:00.000Z' });

    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/normal`, headers, payload: { target } });
    s.advance(min(2));
    const late = await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/normal/undo`, headers, payload: { target } });
    expect(late.statusCode).toBe(409);
  });
});

describe('Today history and the conflict tap', () => {
  it('tells the day in plain sentences, newest first, and records calm, grumble or meltdown once per ending', async () => {
    const s = await setup();
    const headers = await signedIn(s.db, s.owner);
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers, payload: { target: { kind: 'service', id: s.youtube.id }, type: 'allow', duration: '30m' } });
    s.advance(min(31));
    const history = HistoryEntry.array().parse((await s.app.inject({ url: `/api/children/${s.child}/history`, headers })).json());
    expect(history.map((e) => `${e.time} ${e.text}`)).toEqual([
      "19:02 Ollie's extra YouTube time ended.",
      '18:32 Mum allowed YouTube until 19:02.',
      '18:15 Tea pause ended.',
      '17:30 Tea pause started.',
    ]);
    const ending = history[0]!.ending!;
    expect(ending.mood).toBeNull();

    const tap = (mood: string) => s.app.inject({ method: 'POST', url: `/api/children/${s.child}/endings`, headers, payload: { ref: ending.ref, mood } });
    expect((await tap('grumble')).statusCode).toBe(201);
    expect((await tap('calm')).statusCode).toBe(201);
    expect(await s.db.select({ mood: sessionEndings.mood }).from(sessionEndings)).toEqual([{ mood: 'calm' }]);
    const again = HistoryEntry.array().parse((await s.app.inject({ url: `/api/children/${s.child}/history`, headers })).json());
    expect(again[0]!.ending!.mood).toBe('calm');
  });

  it("includes the child's planned session, and offers the tap when it ends", async () => {
    const s = await setup();
    const headers = await signedIn(s.db, s.owner);
    const [g] = await s.db
      .insert(grants)
      .values({ householdId: s.hh, childId: s.child, targetKind: 'service', targetId: s.youtube.id, startsAt: new Date('2026-10-26T18:30:00Z'), endsAt: new Date('2026-10-26T19:00:00Z'), source: 'planned', status: 'active' })
      .returning();
    const now = HistoryEntry.array().parse((await s.app.inject({ url: `/api/children/${s.child}/history`, headers })).json());
    expect(now[0]).toMatchObject({ time: '18:30', text: 'YouTube unlocked. Ollie planned 30 minutes.' });
    expect(now[0]!.ending).toBeUndefined();
    s.advance(min(30));
    const later = HistoryEntry.array().parse((await s.app.inject({ url: `/api/children/${s.child}/history`, headers })).json());
    expect(later[0]).toMatchObject({ time: '19:00', text: "Ollie's YouTube time ended.", ending: { ref: `end:${g!.id}`, mood: null } });
    expect((await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/endings`, headers, payload: { ref: `end:${g!.id}`, mood: 'calm' } })).statusCode).toBe(201);
  });

  it('refuses a tap on something that has not ended or is not this child', async () => {
    const s = await setup();
    const headers = await signedIn(s.db, s.owner);
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers, payload: { target: { kind: 'service', id: s.youtube.id }, type: 'allow', duration: '30m' } });
    const [o] = await s.db.select().from(overrides);
    expect((await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/endings`, headers, payload: { ref: `end:${o!.id}`, mood: 'calm' } })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/endings`, headers, payload: { ref: 'end:nope', mood: 'calm' } })).statusCode).toBe(400);
  });
});

describe('Live updates', () => {
  it('streams a change to an open Control screen when a parent acts', async () => {
    const s = await setup();
    const headers = await signedIn(s.db, s.owner);
    const address = await s.app.listen({ host: '127.0.0.1', port: 0 });
    const res = await fetch(`${address}/api/events`, { headers: { cookie: headers.cookie! } });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const until = async (needle: string) => {
      while (!text.includes(needle)) text += decoder.decode((await reader.read()).value);
    };
    await until('event: ready');
    await s.app.inject({ method: 'POST', url: `/api/children/${s.child}/overrides`, headers, payload: { target: { kind: 'everything' }, type: 'pause', duration: '30m' } });
    await until('event: change');
    await reader.cancel();
  });

  it('is for signed-in people only', async () => {
    const s = await setup();
    expect((await s.app.inject({ url: '/api/events' })).statusCode).toBe(401);
  });
});

describe('Alerts and help feedback', () => {
  const sub = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'BPk', auth: 'xyz' } };

  it('says when alerts are not set up yet', async () => {
    const s = await setup();
    const res = await s.app.inject({ url: '/api/push/key', headers: await signedIn(s.db, s.owner) });
    expect(res.statusCode).toBe(409);
  });

  it('gives the key, keeps one subscription per browser, and removes it', async () => {
    const s = await setup({ vapidPublicKey: 'BPublicKey' });
    const mum = await signedIn(s.db, s.owner);
    const gran = await signedIn(s.db, s.carer);
    expect((await s.app.inject({ url: '/api/push/key', headers: mum })).json()).toEqual({ publicKey: 'BPublicKey' });
    expect((await s.app.inject({ method: 'POST', url: '/api/push/subscriptions', headers: mum, payload: sub })).statusCode).toBe(201);
    await s.app.inject({ method: 'POST', url: '/api/push/subscriptions', headers: gran, payload: sub });
    const rows = await s.db.select().from(pushSubscriptions);
    expect(rows.map((r) => r.personId)).toEqual([s.carer]);
    expect((await s.app.inject({ method: 'DELETE', url: '/api/push/subscriptions', headers: mum, payload: { endpoint: sub.endpoint } })).statusCode).toBe(204);
    expect(await s.db.select().from(pushSubscriptions)).toHaveLength(1);
    await s.app.inject({ method: 'DELETE', url: '/api/push/subscriptions', headers: gran, payload: { endpoint: sub.endpoint } });
    expect(await s.db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("refuses a push endpoint that is not a browser's push service", async () => {
    const s = await setup({ vapidPublicKey: 'BPublicKey' });
    const headers = await signedIn(s.db, s.owner);
    for (const endpoint of ['http://web.push.apple.com/x', 'https://internal:3000/x', 'https://push.apple.com.evil.example/x', 'https://evilpush.apple.com.example/x']) {
      const res = await s.app.inject({ method: 'POST', url: '/api/push/subscriptions', headers, payload: { ...sub, endpoint } });
      expect(res.statusCode, endpoint).toBe(400);
    }
    const fcm = await s.app.inject({ method: 'POST', url: '/api/push/subscriptions', headers, payload: { ...sub, endpoint: 'https://fcm.googleapis.com/fcm/send/abc' } });
    expect(fcm.statusCode).toBe(201);
  });

  it('stores "Was this helpful?" on the home server', async () => {
    const s = await setup();
    const res = await s.app.inject({ method: 'POST', url: '/api/help/feedback', headers: await signedIn(s.db, s.owner), payload: { topicId: 'pause-everything', helpful: true } });
    expect(res.statusCode).toBe(201);
    expect(await s.db.select({ topicId: helpFeedback.topicId, helpful: helpFeedback.helpful }).from(helpFeedback)).toEqual([{ topicId: 'pause-everything', helpful: true }]);
  });
});
