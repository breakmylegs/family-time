// Development and end-to-end server: the real api, on PGlite instead of Postgres, serving the
// parent app's build. Never part of the image. Run with `corepack pnpm --filter @family-time/api dev`.
//
//   PORT             port to listen on (5174)
//   FT_DEV_DATA      PGlite data folder; in memory when unset, so every start is a fresh install
//   FT_LINK_FILE     where to write the first owner's invite link, for tests to read
//
// With FT_DEV_DEMO=1 it is the mock's family instead of a fresh install: a fake AdGuard, the real
// reconciler running in-process every few seconds, and a frozen clock (FT_DEV_CLOCK, default
// Monday 26 October 2026, 18:32 London), so screenshots match the mock and repeat exactly. Its
// ledger is the Besu adapter on the fake chain, with the signer and indexer running in-process, so
// the owner's Ledger screen shows blocks; each reset starts a fresh chain and replays onto it.
//
//   FT_SESSION_FILE  where to write signed-in cookies for Mum, Dad and Gran, for WebKit, which
//                    cannot make a passkey in a test
import { AdGuard } from '@family-time/adguard-client';
import { FakeAdGuard } from '@family-time/adguard-client/fake';
import { helpFeedback, ledgerConfirmations, ledgerContracts, ledgerTx, overrides, recordHeartbeat, sessionEndings } from '@family-time/db';
import { activateContract, besuLedger, fakeChain, indexPass, signerPass, type FakeChain } from '@family-time/ledger';
import { eq } from 'drizzle-orm';
import { testDb } from '@family-time/db/testing';
import { reconcile } from '@family-time/worker/reconcile';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from '../src/auth/sessions.js';
import { readBuildInfo } from '../src/build.js';
import { ownerInvite } from '../src/cli/commands.js';
import { Changes } from '../src/events.js';
import { buildServer } from '../src/server.js';
import { seedDemo } from './demo.js';
import { resetEconomy, seedEconomy, type EconomySnapshot } from './economy.js';

const port = Number(process.env.PORT ?? 5174);
const origin = `http://localhost:${port}`;
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', '..', 'parent', 'dist');
const demo = process.env.FT_DEV_DEMO === '1';
const frozen = demo ? new Date(process.env.FT_DEV_CLOCK ?? '2026-10-26T18:32:00Z') : undefined;
const now = () => frozen ?? new Date();

const { db, client } = await testDb(process.env.FT_DEV_DATA ? { dataDir: process.env.FT_DEV_DATA } : {});

// No worker here: keep the heartbeat fresh so /readyz reflects the api alone.
await recordHeartbeat(db, 'dev', now());
setInterval(() => void recordHeartbeat(db, 'dev', now()), 30_000).unref();

const changes = new Changes();
let notifyChange: (() => Promise<void>) | undefined;
let economy: EconomySnapshot | undefined;
let chain: FakeChain | undefined;
let chains = 0;

/** A fresh fake chain with the history replayed onto a new contract, as ledger-deploy would. */
async function newChain() {
  chain = fakeChain({ contract: `0x${(++chains).toString(16).padStart(40, '0')}` });
  await activateContract(db, { address: chain.contract, chainId: 1, version: '1', deployedBlock: 1 });
  await settle();
}
/** Sends and confirms what is queued: twice, so what one pass sends the next sees mined. */
async function settle() {
  if (!chain) return;
  for (let i = 0; i < 3; i++) {
    await signerPass(db, chain);
    await indexPass(db, chain);
  }
}

if (demo) {
  const family = await seedDemo(db, origin);
  economy = await seedEconomy(db, family, { roblox: family.roblox.id, youtubeGrant: family.youtubeGrant.id });
  await newChain();
  setInterval(() => void settle(), 2_000).unref();
  const fake = new FakeAdGuard();
  const adguard = new AdGuard({ baseUrl: await fake.start(), username: fake.username, password: fake.password });
  const quiet = () => undefined;
  // One reconcile at a time, as the worker's singleton queue guarantees.
  let running: Promise<void> | undefined;
  const run = async () => {
    if (running) return running;
    running = (async () => {
      // A short wait, so "Starting. Takes up to a minute" is on screen before "Working now".
      await new Promise((r) => setTimeout(r, 1_500));
      await reconcile({ db, adguard, now, log: quiet });
      changes.emit(family.householdId);
    })().finally(() => (running = undefined));
    return running;
  };
  notifyChange = async () => void run();
  await reconcile({ db, adguard, now, log: quiet });
  setInterval(() => void run(), 10_000).unref();

  if (process.env.FT_SESSION_FILE) {
    const sessions: Record<string, { session: string; csrf: string }> = {};
    for (const [name, person] of [
      ['mum', family.mum],
      ['dad', family.dad],
      ['gran', family.gran],
    ] as const) {
      sessions[name] = { session: await createSession(db, person.id, 'e2e', now()), csrf: randomBytes(24).toString('base64url') };
    }
    writeFileSync(process.env.FT_SESSION_FILE, JSON.stringify({ ...sessions, children: { ollie: family.ollie.id, jamie: family.jamie.id } }));
  }
  console.log(`Demo family ready, clock frozen at ${frozen!.toISOString()}`);
} else {
  try {
    const { link } = await ownerInvite(db, { origin, ownerName: 'Owner', familyName: 'Dev family' }, now());
    console.log(`\nFirst owner invite: ${link}\n`);
    if (process.env.FT_LINK_FILE) writeFileSync(process.env.FT_LINK_FILE, link);
  } catch (err) {
    console.log(`(${(err as Error).message})`);
  }
}

const app = await buildServer({
  db,
  build: readBuildInfo(),
  now,
  changes,
  logLevel: process.env.LOG_LEVEL ?? 'warn',
  ...(notifyChange ? { notifyChange } : {}),
  ...(demo ? { ledger: besuLedger(db), ledgerAdapter: 'besu' as const } : {}),
  ...(existsSync(join(staticDir, 'index.html')) ? { staticDir } : {}),
});
if (demo) {
  // For the end-to-end tests only: back to the mock's 18:32 before each test.
  const seeded = new Set((await db.select({ id: overrides.id }).from(overrides)).map((o) => o.id));
  app.post('/__dev/reset', { config: { access: 'public' } }, async () => {
    for (const o of await db.select({ id: overrides.id }).from(overrides)) if (!seeded.has(o.id)) await db.delete(overrides).where(eq(overrides.id, o.id));
    await db.update(overrides).set({ endsAt: new Date('2026-10-26T19:30:00Z'), endedBy: null, plannedEndsAt: null });
    await db.delete(sessionEndings);
    await db.delete(helpFeedback);
    // The chain cannot forget a reference, and the reset makes the same ones again: a new chain.
    await db.delete(ledgerTx);
    await db.delete(ledgerConfirmations);
    await db.delete(ledgerContracts);
    if (economy) await resetEconomy(db, client, economy);
    await newChain();
    await notifyChange?.();
    return { ok: true };
  });
}

await app.listen({ host: '127.0.0.1', port });
console.log(`Family time dev server on ${origin}`);
