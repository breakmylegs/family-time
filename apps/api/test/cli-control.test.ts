import { AdGuard, BEGIN, END, HAGEZI_BYPASS_LIST, SETTING_ADGUARD_SCOPE, SETTING_BYPASS_RULES } from '@family-time/adguard-client';
import { FakeAdGuard } from '@family-time/adguard-client/fake';
import { allowances, devices, people, policies, schedules, serviceGroups, services, settings } from '@family-time/db';
import { afterEach, describe, expect, it } from 'vitest';
import { ownerInvite } from '../src/cli/commands.js';
import { addChild, addDevice, adguardSetup, type AdGuardSetupOptions, allowanceFor, control, DEFAULT_SCHEDULES, ledgerVerify, pilotPhase, resolveTarget, setChildPronouns, setupDefaults, status, syncServices } from '../src/cli/control.js';
import { seedPerson } from './accounts.js';
import { harness, type Harness } from './helpers.js';

// Monday 26 October 2026, 16:00 London.
const FREE = new Date('2026-10-26T16:00:00Z');

let h: Harness | undefined;
let fake: FakeAdGuard | undefined;
afterEach(async () => {
  await fake?.stop();
  await h?.close();
  h = undefined;
  fake = undefined;
});

async function home() {
  h = await harness({ now: FREE });
  await ownerInvite(h.handle.db, { origin: 'https://family.example.com' }, FREE);
  const [hh] = await h.handle.client.query<{ id: string }>('select id from households').then((r) => r.rows);
  await seedPerson(h.handle.db, hh!.id, 'owner', 'Mum');
  fake = new FakeAdGuard();
  const adguard = new AdGuard({ baseUrl: await fake.start(), username: fake.username, password: fake.password });
  return { db: h.handle.db, householdId: hh!.id, adguard };
}

describe('setting up from the command line', () => {
  it('adds a child, a device, the defaults and the catalogue, then controls them', async () => {
    const { db, adguard } = await home();
    await addChild(db, 'Ollie');
    await expect(addChild(db, 'ollie')).rejects.toThrow(/already a child/);
    const device = await addDevice(db, { child: 'Ollie', label: "Ollie's iPad", type: 'ipad', ids: ['192.168.1.50', 'AA:BB:CC:DD:EE:FF'] });
    expect(device.adguardName).toMatch(/^ft-[0-9a-f]{12}$/);
    expect((await db.select().from(devices))[0]!.identifiers).toEqual(['192.168.1.50', 'aa:bb:cc:dd:ee:ff']);

    const done = await setupDefaults(db, 'Ollie');
    expect(done).toContain('group: Games');
    expect(await db.select().from(schedules)).toHaveLength(DEFAULT_SCHEDULES.length);
    expect(await db.select().from(policies)).toHaveLength(4);
    expect(await setupDefaults(db, 'Ollie')).toEqual([]); // adds only what is missing

    const synced = await syncServices(db, adguard);
    expect(synced.added).toEqual(expect.arrayContaining(['YouTube', 'Roblox', 'TikTok']));
    expect(synced.missing).toContain('minecraft'); // the fake's catalogue is small
    const youtube = (await db.select().from(services)).find((s) => s.adguardId === 'youtube')!;
    expect(youtube.domains).toEqual(expect.arrayContaining(['youtube.com', 'googlevideo.com']));

    const s = await status(db, 'Ollie', FREE);
    expect(s.services.find((x) => x.name === 'Roblox')).toMatchObject({ state: 'blocked', reason: 'Not planned today. Usual school night rule.' });

    const target = await resolveTarget(db, { group: 'games' });
    const after = await control(db, { child: 'Ollie', type: 'allow', target, duration: '1h' }, FREE);
    expect(after.services.find((x) => x.name === 'Roblox')).toMatchObject({ state: 'allowed', reason: 'Mum allowed it.', until: '2026-10-26T17:00:00.000Z' });
    expect(after.services.find((x) => x.name === 'YouTube')?.state).toBe('blocked');
  });

  it("sets a child's pronouns for the help text, they when unset", async () => {
    const { db } = await home();
    await addChild(db, 'Ollie', 'he');
    await addChild(db, 'Sam');
    await expect(addChild(db, 'Ada', 'xe')).rejects.toThrow(/he, she or they/);
    await setChildPronouns(db, { child: 'Sam', pronouns: 'she' });
    const rows = await db.select({ name: people.displayName, pronouns: people.pronouns }).from(people);
    expect(rows.filter((r) => r.name !== 'Mum' && r.name !== 'Owner').sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: 'Ollie', pronouns: 'he' },
      { name: 'Sam', pronouns: 'she' },
    ]);
  });

  it('moves the pilot phase, sets the allowance in blocks, and checks the ledger', async () => {
    const { db } = await home();
    await addChild(db, 'Ollie');
    expect(await pilotPhase(db)).toMatchObject({ phase: 'baseline', features: { economy: false } });
    expect(await pilotPhase(db, 'reframe')).toMatchObject({ phase: 'reframe', features: { economy: true, bonus: false } });
    await expect(pilotPhase(db, 'later')).rejects.toThrow(/one of: baseline/);
    await allowanceFor(db, { child: 'Ollie', minutes: 420 });
    await expect(allowanceFor(db, { child: 'Ollie', minutes: 425 })).rejects.toThrow(/30-minute blocks/);
    expect((await db.select().from(allowances))[0]).toMatchObject({ weeklyMinutes: 420 });
    expect(await ledgerVerify(db)).toEqual({ ok: true, checked: 0 });
  });

  it('refuses bad device identifiers and unclear targets, in words', async () => {
    const { db } = await home();
    await addChild(db, 'Ollie');
    await expect(addDevice(db, { child: 'Ollie', label: 'x', type: 'ipad', ids: [] })).rejects.toThrow(/at least one --id/);
    await expect(addDevice(db, { child: 'Ollie', label: 'x', type: 'ipad', ids: ["1.2.3.4'; drop"] })).rejects.toThrow(/doesn't look like an address/);
    await expect(addDevice(db, { child: 'Nobody', label: 'x', type: 'ipad', ids: ['1.2.3.4'] })).rejects.toThrow(/No child called Nobody/);
    await expect(resolveTarget(db, {})).rejects.toThrow(/Say what/);
    await expect(control(db, { child: 'Ollie', type: 'allow', target: { kind: 'everything' } }, FREE)).rejects.toThrow(/--for/);
  });
});

describe('adguard-setup', () => {
  const options = (apply: boolean, more: Partial<AdGuardSetupOptions> = {}): AdGuardSetupOptions => ({ username: 'familytime', password: 'pw', apply, mode: 'external', scope: 'all', ...more });

  it('shows every global setting it would change, as it is now and as it will be, and changes nothing without --yes', async () => {
    const { db, adguard } = await home();
    const { steps } = await adguardSetup(db, adguard, options(false));
    expect(steps.map((s) => s.what)).toEqual([
      'How long devices keep a block or an answer',
      'Query log kept for',
      'Statistics kept for',
      'Blocklist of DoH, VPN and proxy services',
      'Bypass rules',
    ]);
    expect(steps[0]).toMatchObject({ from: '3600s blocked, 0s max' });
    expect(steps[1]).toMatchObject({ from: '90 days', to: expect.stringMatching(/^7 days/) });
    expect(steps[2]).toMatchObject({ from: '1 days', to: '30 days' });
    expect(fake!.writes).toEqual([]);
    expect(await db.select().from(settings).then((r) => r.filter((x) => x.key === SETTING_BYPASS_RULES))).toEqual([]);
  });

  it('applies everything with --yes, and then has nothing left to do', async () => {
    const { db, adguard } = await home();
    await adguardSetup(db, adguard, options(true));
    expect(fake!.dnsConfig).toMatchObject({ blocked_response_ttl: 10, cache_ttl_max: 60 });
    expect(fake!.querylogConfig.interval).toBe(7 * 86_400_000);
    expect(fake!.statsConfig.interval).toBe(30 * 86_400_000);
    expect(fake!.filters.map((f) => f.url)).toEqual([HAGEZI_BYPASS_LIST.url]);
    expect((await db.select().from(settings)).find((x) => x.key === SETTING_BYPASS_RULES)?.value).toBe(true);
    expect((await adguardSetup(db, adguard, options(true))).steps).toEqual([]);
  });

  it('runs AdGuard first-time setup on a fresh bundled install, with our credentials', async () => {
    h = await harness({ now: FREE });
    await ownerInvite(h.handle.db, { origin: 'https://family.example.com' }, FREE);
    fake = new FakeAdGuard({ configured: false });
    const url = await fake.start();
    const { steps } = await adguardSetup(h.handle.db, new AdGuard({ baseUrl: url, username: 'familytime', password: 'pw' }), options(true, { mode: 'bundled' }));
    expect(steps[0]?.what).toBe('AdGuard first-time setup');
    expect(fake.configured).toBe(true);
    expect(fake.username).toBe('familytime');
    expect(await serviceGroupsCount()).toBe(0);
  });

  it('never runs the first-time setup on an external AdGuard', async () => {
    h = await harness({ now: FREE });
    await ownerInvite(h.handle.db, { origin: 'https://family.example.com' }, FREE);
    fake = new FakeAdGuard({ configured: false });
    const url = await fake.start();
    await expect(adguardSetup(h.handle.db, new AdGuard({ baseUrl: url, username: 'familytime', password: 'pw' }), options(true))).rejects.toThrow(/never runs the first-time setup/);
    expect(fake.configured).toBe(false);
  });

  it('refuses a wrong login or an untested AdGuard before changing anything, and says why', async () => {
    const { db } = await home();
    const wrong = new AdGuard({ baseUrl: await restart(), username: 'familytime', password: 'nope' });
    await expect(adguardSetup(db, wrong, options(true))).rejects.toThrow(/refused the login for user familytime/);
    fake!.version = 'v0.108.0';
    const right = new AdGuard({ baseUrl: await restart(), username: fake!.username, password: fake!.password });
    await expect(adguardSetup(db, right, options(true))).rejects.toThrow(/newer series than the tested v0\.107\.79/);
    expect(fake!.writes).toEqual([]);
    const ok = await adguardSetup(db, right, options(false, { allowUntested: true }));
    expect(ok.notes.join(' ')).toMatch(/ADGUARD_ALLOW_UNTESTED=1/);
  });

  it('with --family-time-only, leaves the global settings alone and needs the markers first', async () => {
    const { db, adguard } = await home();
    await expect(adguardSetup(db, adguard, options(true, { scope: 'family-time-only' }))).rejects.toThrow(/no family-time markers yet[\s\S]*Custom filtering rules/);
    fake!.userRules = ['||theirs.example^', BEGIN, END];
    const { steps, notes } = await adguardSetup(db, adguard, options(true, { scope: 'family-time-only' }));
    expect(steps.map((s) => s.what)).toEqual(['What Family time manages in AdGuard']);
    expect(notes.join(' ')).toMatch(/Left as they are/);
    expect(fake!.writes).toEqual([]);
    expect((await db.select().from(settings)).find((x) => x.key === SETTING_ADGUARD_SCOPE)?.value).toBe('family-time-only');
    expect(fake!.dnsConfig).toMatchObject({ blocked_response_ttl: 3600 });
  });
});

/** The same fake on a new port, after a test changed it. */
async function restart() {
  await fake!.stop();
  return fake!.start();
}

async function serviceGroupsCount() {
  return (await h!.handle.db.select().from(serviceGroups)).length;
}
