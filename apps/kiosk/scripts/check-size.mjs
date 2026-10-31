// The kiosk's JavaScript must stay under 150 KB (brief Part 11): an old Fire tablet loads it on
// every screen-on. Fails the build when it grows past that.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 150 * 1024;
const assets = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'assets');
const total = readdirSync(assets)
  .filter((f) => f.endsWith('.js'))
  .reduce((n, f) => n + statSync(join(assets, f)).size, 0);
console.log(`kiosk: ${(total / 1024).toFixed(1)} KB of JavaScript (limit ${LIMIT / 1024} KB)`);
if (total > LIMIT) {
  console.error('kiosk: the JavaScript is over the limit. Trim it before shipping.');
  process.exit(1);
}
