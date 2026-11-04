// The whole check. Stops at the first failure. Typecheck runs last, so it sees the final tree.
// The image's test stage runs this too (`--in-image`), with no network, before any deploy.
//
//   corepack pnpm gate                   on the laptop
//   corepack pnpm gate:full              on the laptop, plus the update.sh scenarios (slow here)
//   node scripts/gate.mjs --in-image     inside the test stage (run by update.sh)
import { spawnSync } from 'node:child_process';

const inImage = process.argv.includes('--in-image');
const withDeploy = inImage || process.argv.includes('--with-deploy');

const steps = [
  ['lint', ['exec', 'eslint', '.', '--max-warnings=0']],
  ['dashes', ['run', 'check:dashes']],
  ['secrets', ['run', 'check:secrets']],
  ['test', ['exec', 'turbo', 'run', 'test', '--concurrency=2', '--output-logs=errors-only']],
  ['build', ['exec', 'turbo', 'run', 'build', '--output-logs=errors-only']],
  // Browsers drive the real api on PGlite. The image has no browsers, so this runs here only.
  ...(inImage ? [] : [['e2e', ['exec', 'playwright', 'test']]]),
  // update.sh's scenario tests start a few hundred processes. That takes seconds on Linux and about
  // an hour on the Windows laptop, where every process start costs seconds. So they always run in
  // the image, which means update.sh tests the new version of itself before using it, and on the
  // laptop only with --with-deploy (pnpm gate:full) after a change to the deploy scripts.
  ...(withDeploy ? [['deploy-scripts', ['run', 'test:deploy']], ['ops-scripts', ['run', 'test:ops']]] : []),
  ['typecheck', ['exec', 'turbo', 'run', 'typecheck', '--output-logs=errors-only']],
];

const pnpm = process.env.npm_execpath?.includes('pnpm') ? process.env.npm_execpath : null;
const total = Date.now();
for (const [name, args] of steps) {
  const started = Date.now();
  process.stdout.write(`\n== gate: ${name}\n`);
  const r = pnpm
    ? spawnSync(process.execPath, [pnpm, ...args], { stdio: 'inherit' })
    : spawnSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.status !== 0) {
    console.error(`\n== gate FAILED at ${name} (exit ${r.status ?? r.signal}) after ${secs}s`);
    process.exit(r.status || 1);
  }
  console.log(`== gate: ${name} ok in ${secs}s`);
}
console.log(`\n== gate passed in ${((Date.now() - total) / 1000).toFixed(0)}s`);
