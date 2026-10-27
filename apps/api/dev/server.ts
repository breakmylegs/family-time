// Development and end-to-end server: the real api, on PGlite instead of Postgres, serving the
// parent app's build. Never part of the image. Run with `corepack pnpm --filter @family-time/api dev`.
//
//   PORT          port to listen on (5174)
//   FT_DEV_DATA   PGlite data folder; in memory when unset, so every start is a fresh install
//   FT_LINK_FILE  where to write the first owner's invite link, for tests to read
import { recordHeartbeat } from '@family-time/db';
import { testDb } from '@family-time/db/testing';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildInfo } from '../src/build.js';
import { ownerInvite } from '../src/cli/commands.js';
import { buildServer } from '../src/server.js';

const port = Number(process.env.PORT ?? 5174);
const origin = `http://localhost:${port}`;
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', '..', 'parent', 'dist');

const { db } = await testDb(process.env.FT_DEV_DATA ? { dataDir: process.env.FT_DEV_DATA } : {});

// No worker here: keep the heartbeat fresh so /readyz reflects the api alone.
await recordHeartbeat(db, 'dev', new Date());
setInterval(() => void recordHeartbeat(db, 'dev', new Date()), 30_000).unref();

try {
  const { link } = await ownerInvite(db, { origin, ownerName: 'Owner', familyName: 'Dev family' }, new Date());
  console.log(`\nFirst owner invite: ${link}\n`);
  if (process.env.FT_LINK_FILE) writeFileSync(process.env.FT_LINK_FILE, link);
} catch (err) {
  console.log(`(${(err as Error).message})`);
}

const app = await buildServer({
  db,
  build: readBuildInfo(),
  logLevel: process.env.LOG_LEVEL ?? 'warn',
  ...(existsSync(join(staticDir, 'index.html')) ? { staticDir } : {}),
});
await app.listen({ host: '127.0.0.1', port });
console.log(`Family time dev server on ${origin}`);
