// The behaviours the control service depends on. Here they run against the fake AdGuard; in the
// deploy's test project they run against the real v0.107.79 container (ADGUARD_URL set). If the
// two ever disagree, the server run fails and the fake gets fixed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdGuard, BEGIN, desiredClient, END, matches, newClient, withOurRules } from '../src/index.js';
import { FakeAdGuard } from '../src/fake.js';

const REAL = process.env.ADGUARD_URL;
const USER = process.env.ADGUARD_USER ?? 'familytime';
const PASS = process.env.ADGUARD_PASSWORD ?? 'contract-test-password';

let fake: FakeAdGuard | undefined;
let ag: AdGuard;
let baseUrl: string;

beforeAll(async () => {
  if (REAL) baseUrl = REAL;
  else {
    fake = new FakeAdGuard({ configured: false });
    baseUrl = await fake.start();
  }
  // A fresh container takes a moment to listen. Wait for it, up to 60 seconds.
  const setup = new AdGuard({ baseUrl, username: USER, password: PASS, timeoutMs: 2_000 });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(new URL('/', baseUrl), { signal: AbortSignal.timeout(2_000), redirect: 'manual' });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  // A fresh AdGuard starts in its install wizard: configure it the way ft.sh adguard-setup does.
  try {
    await setup.installAddresses();
    await setup.configure({ web: { ip: '0.0.0.0', port: 3000 }, dns: { ip: '0.0.0.0', port: 53 }, username: USER, password: PASS });
  } catch {
    // Already configured.
  }
  ag = new AdGuard({ baseUrl, username: USER, password: PASS });
});

afterAll(async () => {
  await fake?.stop();
});

const name = `ft-contract${Date.now().toString(36).slice(-6)}`;

describe(`AdGuard contract (${REAL ? 'real container' : 'fake'})`, () => {
  it('answers status once configured, and refuses wrong credentials', async () => {
    expect((await ag.status()).running).toBe(true);
    const wrong = new AdGuard({ baseUrl, username: USER, password: 'wrong' });
    await expect(wrong.status()).rejects.toThrow();
  });

  it('lists YouTube and Roblox among the built-in services, with their domains', async () => {
    const all = await ag.blockedServices();
    for (const id of ['youtube', 'roblox']) {
      const s = all.find((x) => x.id === id);
      expect(s, id).toBeDefined();
      expect(s!.rules.length).toBeGreaterThan(0);
    }
  });

  it('adds a client and reads it back', async () => {
    await ag.addClient(newClient(name, ['192.0.2.10'], [], 'Europe/London'));
    const c = await ag.findClient(name);
    expect(c?.ids).toEqual(['192.0.2.10']);
  });

  it('replaces the whole client on update: what we send is what it holds', async () => {
    const current = (await ag.findClient(name))!;
    const wanted = desiredClient(current, ['youtube', 'roblox'], 'Europe/London');
    await ag.updateClient(name, wanted);
    const after = await ag.findClient(name);
    expect(matches(after, wanted)).toBe(true);
    expect([...(after!.blocked_services ?? [])].sort()).toEqual(['roblox', 'youtube']);
    expect(after!.use_global_blocked_services).toBe(false);
  });

  it('unblocks by sending the same client with an empty list', async () => {
    const current = (await ag.findClient(name))!;
    await ag.updateClient(name, desiredClient(current, [], 'Europe/London'));
    expect((await ag.findClient(name))!.blocked_services ?? []).toEqual([]);
  });

  it('refuses to update a client that does not exist', async () => {
    await expect(ag.updateClient('ft-nobody', newClient('ft-nobody', ['192.0.2.99'], [], 'Europe/London'))).rejects.toThrow(/400/);
  });

  it('replaces every user rule on set_rules, so ours must be merged in', async () => {
    const before = await ag.userRules();
    const mine = withOurRules([...before, '||contract-other.example^'], [`||contract.example^$client='${name}'`]);
    await ag.setRules(mine);
    const after = await ag.userRules();
    expect(after).toEqual(mine);
    expect(after).toContain(BEGIN);
    expect(after).toContain(END);
    expect(after).toContain('||contract-other.example^');
    await ag.setRules(before);
  });

  it('serves the query log newest first, in the shape we read', async () => {
    const log = await ag.querylog({ limit: 10 });
    expect(Array.isArray(log.data)).toBe(true);
    expect(typeof log.oldest).toBe('string');
    for (let i = 1; i < log.data.length; i++) expect(log.data[i - 1]!.time >= log.data[i]!.time).toBe(true);
  });
});
