// Real-infrastructure tests, in order: the db package migrates first, then the api and the worker
// run against the migrated database, then the AdGuard contract tests against a fresh AdGuard.
// Runs inside the deploy's throwaway test project only.
import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL) {
  console.error('test-pg: DATABASE_URL is not set. This runs only in deploy/compose.test.yml.');
  process.exit(2);
}

// The contract tests write clients and rules, so they only ever run against the test project's own
// throwaway AdGuard (deploy/compose.test.yml), never the household's live one (ADR 0022).
const THROWAWAY_ADGUARD = 'http://adguard:3000';
if (process.env.ADGUARD_URL && (process.env.ADGUARD_URL !== THROWAWAY_ADGUARD || process.env.ADGUARD_CONTRACT_TARGET !== 'throwaway')) {
  console.error(`test-pg: the AdGuard contract tests run only against the test project's throwaway AdGuard at ${THROWAWAY_ADGUARD}, never ${process.env.ADGUARD_URL}.`);
  process.exit(2);
}

const suites = [
  ['@family-time/db', 'test:pg'],
  ['@family-time/ledger', 'test:pg'],
  ['@family-time/api', 'test:pg'],
  ['@family-time/worker', 'test:pg'],
  // The contract tests that run against the fake on the laptop, here against the real AdGuard.
  ...(process.env.ADGUARD_URL ? [['@family-time/adguard-client', 'test:adguard']] : []),
];
for (const [pkg, script] of suites) {
  console.log(`\n== test-pg: ${pkg} ${script}`);
  const r = spawnSync('pnpm', ['--filter', pkg, 'run', script], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`== test-pg FAILED in ${pkg} (exit ${r.status ?? r.signal})`);
    process.exit(r.status || 1);
  }
}
console.log('\n== test-pg passed');
