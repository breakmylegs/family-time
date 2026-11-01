// Phase 8 through the api: maintenance mode pauses changes but never reading or signing in; the
// System page, audit log and export are the owner's; export leaves out what lets someone sign in;
// the audit CSV never hands a spreadsheet a formula; the pilot measures add up.
import { auditEvents, completions, devices, recordBackup, schedules, services, sessionEndings, setMaintenance, tasks, usageMinutes } from '@family-time/db';
import { AuditPage, PilotMeasures, SystemView } from '@family-time/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import { parseChangelog } from '../src/system/releases.js';
import { seedHousehold, seedPerson, signedIn } from './accounts.js';
import { harness, type Harness } from './helpers.js';

// Monday 26 October 2026, 18:32 London.
const NOW = new Date('2026-10-26T18:32:00Z');

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function seed(hh: Harness) {
  const db = hh.handle.db;
  const home = await seedHousehold(db);
  const mum = await seedPerson(db, home, 'owner', 'Mum');
  const dad = await seedPerson(db, home, 'parent', 'Dad');
  const ollie = await seedPerson(db, home, 'child', 'Ollie');
  return { home, mum, dad, ollie, headers: { mum: await signedIn(db, mum), dad: await signedIn(db, dad) } };
}

describe('maintenance mode', () => {
  it('pauses changes with the message, while reading and signing in still work', async () => {
    h = await harness({ now: NOW });
    const s = await seed(h);
    await setMaintenance(h.handle.db, { on: true, message: 'Back by 21:00.' }, NOW);
    expect((await h.app.inject({ url: '/api/maintenance' })).json()).toMatchObject({ on: true, message: 'Back by 21:00.' });
    const change = await h.app.inject({ method: 'POST', url: `/api/children/${s.ollie}/resume`, headers: s.headers.mum });
    expect(change.statusCode).toBe(503);
    expect(change.json()).toEqual({ error: 'maintenance', detail: 'Back by 21:00. Changes are paused until then.' });
    expect((await h.app.inject({ url: `/api/children/${s.ollie}/status`, headers: s.headers.mum })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: s.headers.dad })).statusCode).not.toBe(503);
    await setMaintenance(h.handle.db, { on: false, message: null }, NOW);
    expect((await h.app.inject({ method: 'POST', url: `/api/children/${s.ollie}/resume`, headers: s.headers.mum })).statusCode).toBe(200);
  });
});

describe('the System page', () => {
  it('shows the owner the version, health, backup, pilot, retention and release notes', async () => {
    h = await harness({ now: NOW });
    const s = await seed(h);
    await recordBackup(h.handle.db, { ok: true, bytes: 812_345, snapshot: 'a1b2c3', problem: null }, NOW);
    const res = await h.app.inject({ url: '/api/system', headers: s.headers.mum });
    const v = SystemView.parse(res.json());
    expect(v.version).toMatchObject({ commit: 'abc123' });
    expect(v.version.app).toMatch(/^\d+\.\d+\.\d+$/);
    expect(v.lastBackup).toMatchObject({ ok: true, bytes: 812_345, snapshot: 'a1b2c3' });
    expect(v.pilot.phase).toBe('baseline');
    expect(v.retention.map((r) => r.what)).toContain('Sign-ins, 30 days after they end');
    expect(v.releases[0]!.notes.length).toBeGreaterThan(0);
    expect((await h.app.inject({ url: '/api/system', headers: s.headers.dad })).statusCode).toBe(403);
  });

  it('reads release notes from the changelog', () => {
    expect(parseChangelog('# Changelog\n\nIntro.\n\n## 0.2.0 (Phase 1, accounts)\n\n- Passkeys.\n- Invites.\n\n## 0.1.0\n\n- Health.\n')).toEqual([
      { version: '0.2.0', title: 'Phase 1, accounts', notes: ['Passkeys.', 'Invites.'] },
      { version: '0.1.0', title: '', notes: ['Health.'] },
    ]);
  });
});

describe('the audit log', () => {
  it('pages newest first, filters by action, and never hands a spreadsheet a formula', async () => {
    h = await harness({ now: NOW });
    const s = await seed(h);
    const db = h.handle.db;
    for (let i = 0; i < 55; i++) await db.insert(auditEvents).values({ householdId: s.home, actorPersonId: s.mum, action: 'control.allow', at: new Date(NOW.getTime() - i * 60_000) });
    await db.insert(auditEvents).values({ householdId: s.home, actorLabel: 'cli', action: 'pilot.phase', after: { note: '=HYPERLINK("http://evil.example")' }, at: new Date(NOW.getTime() + 1000) });
    const first = AuditPage.parse((await h.app.inject({ url: '/api/audit', headers: s.headers.mum })).json());
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0]!.by).toBe('cli');
    const second = AuditPage.parse((await h.app.inject({ url: `/api/audit?before=${encodeURIComponent(first.older!)}`, headers: s.headers.mum })).json());
    expect(second.entries.length).toBeGreaterThan(0);
    expect(second.entries.every((e) => e.at < first.older!)).toBe(true);
    const filtered = AuditPage.parse((await h.app.inject({ url: '/api/audit?action=pilot', headers: s.headers.mum })).json());
    expect(filtered.entries.map((e) => e.action)).toEqual(['pilot.phase']);

    const csv = (await h.app.inject({ url: '/api/audit.csv?action=pilot', headers: s.headers.mum })).body;
    expect(csv.split('\r\n')[0]).toBe('When (UTC),Who,Action,Target,Detail');
    expect(csv).not.toMatch(/,"?=HYPERLINK/);
    const cli = await h.app.inject({ method: 'POST', url: '/api/audit', headers: s.headers.mum });
    expect(cli.statusCode).toBe(404);
  });
});

describe('export', () => {
  it("gives the owner the family's data, and leaves out what lets someone sign in", async () => {
    h = await harness({ now: NOW });
    const s = await seed(h);
    await h.handle.db.insert(services).values({ householdId: s.home, name: 'YouTube', source: 'adguard', adguardId: 'youtube', domains: ['youtube.com'] });
    const res = await h.app.inject({ url: '/api/export', headers: s.headers.mum });
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="family-time-export-2026-10-26.json"/);
    const data = res.json();
    expect(data).toMatchObject({ format: 'family-time-export', version: 1, household: { id: s.home } });
    expect(data.tables.people.map((p: { displayName: string }) => p.displayName).sort()).toEqual(['Dad', 'Mum', 'Ollie']);
    expect(data.tables.services).toHaveLength(1);
    expect(data.leftOut.length).toBeGreaterThan(0);
    expect(JSON.stringify(data.tables)).not.toMatch(/token_?hash|idHash|sealed|publicKey/i);
    expect((await h.app.inject({ url: '/api/export', headers: s.headers.dad })).statusCode).toBe(403);
  });
});

describe('pilot measures', () => {
  it('count minutes by app, minutes at bedtime, endings and jobs, week by week', async () => {
    h = await harness({ now: NOW });
    const s = await seed(h);
    const db = h.handle.db;
    await db.insert(schedules).values({ householdId: s.home, name: 'School night', weekdays: [0, 1, 2, 3, 4, 5, 6], blocks: [{ type: 'wind-down', start: '19:30', end: '20:30' }, { type: 'bed', start: '20:30', end: '07:00' }] });
    const [yt] = await db.insert(services).values({ householdId: s.home, name: 'YouTube', source: 'adguard', adguardId: 'youtube', domains: ['youtube.com'] }).returning();
    const [ipad] = await db.insert(devices).values({ householdId: s.home, childId: s.ollie, label: 'iPad', type: 'ipad', adguardName: 'ft-ipad', identifiers: ['192.168.1.50'] }).returning();
    // Monday 26 October: 17:00 and 17:01 (free time, GMT), 21:00 (bedtime), and one quiet minute that does not count.
    const at = (hhmm: string) => new Date(`2026-10-26T${hhmm}:00Z`);
    await db.insert(usageMinutes).values([
      { deviceId: ipad!.id, serviceId: yt!.id, minute: at('17:00'), queries: 5 },
      { deviceId: ipad!.id, serviceId: yt!.id, minute: at('17:01'), queries: 4 },
      { deviceId: ipad!.id, serviceId: yt!.id, minute: at('17:02'), queries: 1 },
    ]);
    await db.insert(sessionEndings).values([
      { childId: s.ollie, ref: 'a', endedAt: at('17:30'), mood: 'calm', byPersonId: s.mum },
      { childId: s.ollie, ref: 'b', endedAt: at('17:40'), mood: 'grumble', byPersonId: s.mum },
    ]);
    const [job] = await db.insert(tasks).values({ householdId: s.home, title: 'Set the table', rewardType: 'money', amount: 20, createdBy: s.mum }).returning();
    await db.insert(completions).values({ taskId: job!.id, childId: s.ollie, loggedAt: at('17:10'), status: 'approved', decidedBy: s.mum, decidedAt: at('17:15') });

    const later = new Date('2026-10-26T21:05:00Z');
    await db.insert(usageMinutes).values({ deviceId: ipad!.id, serviceId: yt!.id, minute: new Date('2026-10-26T21:00:00Z'), queries: 6 });
    const m = PilotMeasures.parse((await h.app.inject({ url: `/api/children/${s.ollie}/measures`, headers: s.headers.dad })).json());
    void later;
    const week = m.weeks[0]!;
    expect(week).toMatchObject({ minutesByApp: [{ app: 'YouTube', minutes: 3 }], bedtimeMinutes: 1, windDownMinutes: 0, endings: { calm: 1, grumble: 1, meltdown: 0 }, jobsApproved: 1, offlineVariety: 1 });
    const csv = (await h.app.inject({ url: `/api/children/${s.ollie}/measures.csv`, headers: s.headers.dad })).body;
    expect(csv.split('\r\n')[0]).toContain('YouTube minutes');
    expect(csv.split('\r\n')[1]).toMatch(/^Ollie,/);
  });
});
