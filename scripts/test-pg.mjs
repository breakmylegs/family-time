// Real-Postgres tests, in order: the db package migrates first, then the api and the worker run
// against the migrated database. Runs inside the deploy's throwaway test project only.
import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.error('test-pg: DATABASE_URL is not set. This runs only in deploy/compose.test.yml.');
  process.exit(2);
}

for (const pkg of ['@family-time/db', '@family-time/api', '@family-time/worker']) {
  console.log(`\n== test-pg: ${pkg}`);
  const r = spawnSync('pnpm', ['--filter', pkg, 'run', 'test:pg'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`== test-pg FAILED in ${pkg} (exit ${r.status ?? r.signal})`);
    process.exit(r.status || 1);
  }
}
console.log('\n== test-pg passed');
