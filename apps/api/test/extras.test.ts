// Phase 11: the setup checklist by age band, things done away from screens with praise, things
// learned, questions about rules, and the parents' estimates in the pilot measures.
import { households } from '@family-time/db';
import { postgresLedger } from '@family-time/ledger';
import { ApprovalItem, ChildExtras, KioskMine, KioskPairing, PilotMeasures, SetupChecklist } from '@family-time/schemas';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { resetBadCodes } from '../src/kiosk/commands.js';
import { buildKioskServer } from '../src/kiosk/server.js';
import { exportHousehold } from '../src/system/export.js';
import { seedHousehold, seedPerson, signedIn } from './accounts.js';
import { harness, LogSink, type Harness } from './helpers.js';

let h: Harness | undefined;
let kiosk: FastifyInstance | undefined;
afterEach(async () => {
  resetBadCodes();
  await kiosk?.close();
  await h?.close();
  h = undefined;
  kiosk = undefined;
});

/** Monday 26 October 2026, 16:00 London, with a kiosk paired. */
async function setup() {
  const clock = { at: new Date('2026-10-26T16:00:00Z') };
  h = await harness({ clock: () => clock.at });
  const db = h.handle.db;
  const hh = await seedHousehold(db);
  await db.update(households).set({ pilotPhase: 'transitions' }).where(eq(households.id, hh));
  const mum = await seedPerson(db, hh, 'owner', 'Mum');
  const gran = await seedPerson(db, hh, 'carer', 'Gran');
  const child = await seedPerson(db, hh, 'child', 'Ollie');
  const other = await seedHousehold(db);
  const stranger = await seedPerson(db, other, 'child', 'Sam');
  kiosk = await buildKioskServer({ db, ledger: postgresLedger(db), now: () => clock.at, logStream: new LogSink(), logLevel: 'warn' });
  const headers = { mum: await signedIn(db, mum), gran: await signedIn(db, gran) };
  const made = await h.app.inject({ method: 'POST', url: '/api/kiosks/pairing', headers: headers.mum, payload: { label: 'Tablet' } });
  const { code } = KioskPairing.parse(made.json());
  const token = (await kiosk.inject({ method: 'POST', url: '/api/pair', payload: { code } })).json() as { token: string };
  return { app: h.app, kiosk, db, hh, clock, child, stranger, headers, device: { authorization: `Bearer ${token.token}` } };
}

type S = Awaited<ReturnType<typeof setup>>;
const extras = async (s: S, who: 'mum' | 'gran') => ChildExtras.parse((await s.app.inject({ url: `/api/children/${s.child}/extras`, headers: s.headers[who] })).json());
const mine = async (s: S) => KioskMine.parse((await s.kiosk.inject({ url: `/api/children/${s.child}/mine`, headers: s.device })).json());

describe('the setup checklist', () => {
  it('fits the age band, keeps the ticks, and is for parents of this family only', async () => {
    const s = await setup();
    const list = async () => z.array(SetupChecklist).parse((await s.app.inject({ url: '/api/setup/checklists', headers: s.headers.mum })).json())[0]!;
    // No age yet: only what fits every age.
    expect((await list()).items.map((i) => i.id)).toEqual(['youtube-autoplay', 'bedroom', 'mealtimes']);

    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/age-band`, headers: s.headers.mum, payload: { ageBand: '8-10' } })).statusCode).toBe(200);
    const ids = (await list()).items.map((i) => i.id);
    expect(ids).toContain('roblox-limit');
    expect(ids).toContain('device-limits');
    expect(ids).not.toContain('watch-together');

    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/checklist/roblox-limit`, headers: s.headers.mum, payload: { done: true } })).statusCode).toBe(200);
    expect((await list()).items.find((i) => i.id === 'roblox-limit')?.done).toBe(true);
    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/checklist/not-a-thing`, headers: s.headers.mum, payload: { done: true } })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.stranger}/age-band`, headers: s.headers.mum, payload: { ageBand: '5-7' } })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/age-band`, headers: s.headers.gran, payload: { ageBand: '5-7' } })).statusCode).toBe(403);
  });
});

describe('away from screens', () => {
  it('takes what the child did from the kiosk, with praise back and no points', async () => {
    const s = await setup();
    const added = await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/journal`, headers: s.device, payload: { text: 'Built a den', picture: 'tent' } });
    expect(added.statusCode).toBe(201);
    await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/rule-asks`, headers: s.device, payload: { text: 'Why bedtime at eight?' } });
    await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/unmanaged`, headers: s.headers.mum, payload: { minutes: 60 } });
    expect((await extras(s, 'mum')).ruleAsks).toHaveLength(1);
    const seen = await extras(s, 'gran');
    expect(seen.journal).toMatchObject([{ text: 'Built a den', praise: null }]);
    // Grandparents can praise it, but don't see the parents' notes or the questions about rules.
    expect(seen.ruleAsks).toEqual([]);
    expect(seen.unmanagedMinutes).toBeNull();
    expect((await s.app.inject({ method: 'POST', url: `/api/journal/${seen.journal[0]!.id}/praise`, headers: s.headers.gran, payload: { text: 'What a den!' } })).statusCode).toBe(200);
    expect((await mine(s)).journal[0]).toMatchObject({ praise: 'What a den!', praisedBy: 'Gran' });

    for (let i = 1; i < 10; i++) await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/journal`, headers: s.device, payload: { text: `Thing ${i}` } });
    const eleventh = await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/journal`, headers: s.device, payload: { text: 'One more' } });
    expect(eleventh.statusCode).toBe(409);
  });

  it('marks a skill as mastered only when a grown-up confirms it', async () => {
    const s = await setup();
    const { id } = (await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/skills`, headers: s.device, payload: { title: 'Ride a bike', picture: 'bike' } })).json() as { id: string };
    expect(await mine(s)).toMatchObject({ learning: [{ title: 'Ride a bike' }], canDo: [] });
    expect((await s.app.inject({ method: 'PUT', url: `/api/skills/${id}`, headers: s.headers.gran, payload: { mastered: true } })).statusCode).toBe(200);
    expect(await mine(s)).toMatchObject({ learning: [], canDo: [{ title: 'Ride a bike' }] });
    expect((await s.app.inject({ method: 'DELETE', url: `/api/skills/${id}`, headers: s.headers.mum })).statusCode).toBe(200);
    expect((await mine(s)).canDo).toEqual([]);
  });
});

describe('questions about rules', () => {
  it('reach parents on Approvals, go to the review or get an answer the child sees', async () => {
    const s = await setup();
    const ask = (text: string) => s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/rule-asks`, headers: s.device, payload: { text } });
    expect((await ask('Could I have more time on Saturdays?')).statusCode).toBe(201);

    const mumSees = z.array(ApprovalItem).parse((await s.app.inject({ url: '/api/approvals', headers: s.headers.mum })).json());
    const q = mumSees.find((i) => i.kind === 'question');
    expect(q).toMatchObject({ childName: 'Ollie', text: 'Could I have more time on Saturdays?' });
    expect((await s.app.inject({ url: '/api/approvals/count', headers: s.headers.mum })).json()).toEqual({ waiting: 1 });
    // Carers don't see them, and can't answer them.
    const granSees = z.array(ApprovalItem).parse((await s.app.inject({ url: '/api/approvals', headers: s.headers.gran })).json());
    expect(granSees.some((i) => i.kind === 'question')).toBe(false);
    expect((await s.app.inject({ method: 'POST', url: `/api/rule-asks/${q!.id}/answer`, headers: s.headers.gran, payload: { action: 'review' } })).statusCode).toBe(403);

    expect((await s.app.inject({ method: 'POST', url: `/api/rule-asks/${q!.id}/answer`, headers: s.headers.mum, payload: { action: 'review' } })).statusCode).toBe(200);
    expect((await extras(s, 'mum')).ruleAsks).toMatchObject([{ status: 'review' }]);
    expect((await mine(s)).ruleAsks).toMatchObject([{ status: 'review', answer: null }]);
    // Off Approvals once it is on the agenda.
    expect((await s.app.inject({ url: '/api/approvals/count', headers: s.headers.mum })).json()).toEqual({ waiting: 0 });

    const noWords = await s.app.inject({ method: 'POST', url: `/api/rule-asks/${q!.id}/answer`, headers: s.headers.mum, payload: { action: 'answer' } });
    expect(noWords.statusCode).toBe(400);
    expect((await s.app.inject({ method: 'POST', url: `/api/rule-asks/${q!.id}/answer`, headers: s.headers.mum, payload: { action: 'answer', answer: 'Yes, an extra hour after jobs.' } })).statusCode).toBe(200);
    expect((await mine(s)).ruleAsks).toMatchObject([{ status: 'answered', answer: 'Yes, an extra hour after jobs.' }]);
    expect((await s.app.inject({ method: 'POST', url: `/api/rule-asks/${q!.id}/answer`, headers: s.headers.mum, payload: { action: 'answer', answer: 'Again' } })).statusCode).toBe(409);

    // Three waiting at once at most.
    for (const t of ['One', 'Two', 'Three']) expect((await ask(t)).statusCode).toBe(201);
    expect((await ask('Four')).statusCode).toBe(409);
  });
});

describe('boundaries', () => {
  it("keeps another family's parents out, and a locked child's page behind their PIN", async () => {
    const s = await setup();
    const { id: skill } = (await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/skills`, headers: s.device, payload: { title: 'Swim' } })).json() as { id: string };
    const { id: entry } = (await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/journal`, headers: s.device, payload: { text: 'Swam' } })).json() as { id: string };
    const { id: ask } = (await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/rule-asks`, headers: s.device, payload: { text: 'Why?' } })).json() as { id: string };
    const elsewhere = await signedIn(s.db, await seedPerson(s.db, await seedHousehold(s.db), 'owner', 'Pat'));
    expect((await s.app.inject({ method: 'PUT', url: `/api/skills/${skill}`, headers: elsewhere, payload: { mastered: true } })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'DELETE', url: `/api/skills/${skill}`, headers: elsewhere })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'POST', url: `/api/journal/${entry}/praise`, headers: elsewhere, payload: { text: 'Hi' } })).statusCode).toBe(404);
    expect((await s.app.inject({ method: 'POST', url: `/api/rule-asks/${ask}/answer`, headers: elsewhere, payload: { action: 'review' } })).statusCode).toBe(404);
    expect((await s.app.inject({ url: `/api/children/${s.child}/extras`, headers: elsewhere })).statusCode).toBe(404);

    // With a PIN, the child's own page needs this tablet's ticket.
    expect((await s.app.inject({ method: 'PUT', url: `/api/kiosks/pins/${s.child}`, headers: s.headers.mum, payload: { pin: '4826' } })).statusCode).toBe(200);
    expect((await s.kiosk.inject({ url: `/api/children/${s.child}/mine`, headers: s.device })).statusCode).toBe(423);
    expect((await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/rule-asks`, headers: s.device, payload: { text: 'Again' } })).statusCode).toBe(423);
  });
});

describe("the parents' estimates", () => {
  it('go into the pilot measures, the spreadsheet and the export', async () => {
    const s = await setup();
    await s.kiosk.inject({ method: 'POST', url: `/api/children/${s.child}/journal`, headers: s.device, payload: { text: 'Football' } });
    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/unmanaged`, headers: s.headers.mum, payload: { minutes: 90 } })).statusCode).toBe(200);
    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/mood`, headers: s.headers.mum, payload: { rating: 4, note: 'Happier' } })).statusCode).toBe(200);
    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/mood`, headers: s.headers.mum, payload: { rating: 6 } })).statusCode).toBe(400);
    expect((await s.app.inject({ method: 'PUT', url: `/api/children/${s.child}/mood`, headers: s.headers.gran, payload: { rating: 3 } })).statusCode).toBe(403);

    expect(await extras(s, 'mum')).toMatchObject({ unmanagedMinutes: 90, mood: { month: '2026-10', rating: 4, note: 'Happier' }, monthLabel: 'October' });
    const m = PilotMeasures.parse((await s.app.inject({ url: `/api/children/${s.child}/measures`, headers: s.headers.mum })).json());
    expect(m.weeks[0]).toMatchObject({ unmanagedMinutes: 90, offlineVariety: 1 });
    expect(m.moods).toEqual([{ month: '2026-10', label: 'October 2026', rating: 4, note: 'Happier' }]);
    const csv = (await s.app.inject({ url: `/api/children/${s.child}/measures.csv`, headers: s.headers.mum })).body;
    expect(csv).toContain('Screen time Family time cannot see (estimate, minutes)');
    expect(csv.split('\r\n')[1]).toContain(',1,90,4,');

    const out = await exportHousehold(s.db, s.hh, s.clock.at);
    for (const t of ['journal', 'unmanagedTime', 'moodChecks']) expect(out.tables[t]).toHaveLength(1);
  });
});
