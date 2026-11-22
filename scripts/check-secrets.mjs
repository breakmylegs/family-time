// A small secret scan you can read in one sitting. Looks for private keys, well-known token
// shapes and long literal values assigned to secret-sounding names. Not a substitute for keeping
// secrets in secrets/ (git-ignored, created by scripts/init.sh), but it catches the slip.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, textFiles } from './lib/walk.mjs';

// Patterns are assembled from pieces so this file does not match itself.
const BEGIN = '-----' + 'BEGIN';
const PATTERNS = [
  ['private key', new RegExp(`${BEGIN} (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY`)],
  ['AWS access key', new RegExp('\\b(AKIA|ASIA)' + '[0-9A-Z]{16}\\b')],
  ['GitHub token', new RegExp('\\b(gh[pousr]_' + '[A-Za-z0-9]{36,}|github_pat_' + '[A-Za-z0-9_]{60,})\\b')],
  ['Anthropic key', new RegExp('\\bsk-ant-' + '[A-Za-z0-9_-]{20,}')],
  ['OpenAI key', new RegExp('\\bsk-(proj-)?' + '[A-Za-z0-9]{32,}')],
  ['Google API key', new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b')],
  ['Slack token', new RegExp('\\bxox[abpr]-' + '[A-Za-z0-9-]{10,}')],
  ['hard-coded secret', /\b(password|passwd|secret|api[_-]?key|token|private[_-]?key)\b\s*[:=]\s*['"][^'"\s$]{16,}['"]/i],
];

// Files that must contain a value that looks like a secret, and why. Keep this list short.
const ALLOWED = new Map([]);

// --history: every line ever added in any commit pushed to GitHub (origin's branches), because the
// repository is public and a secret removed later is still in the history. --all-refs adds every
// local ref too. Also lists IP and email addresses for a person to look over: example ranges and
// the project's own addresses are left out. Commit authors' emails are listed as well.
if (process.argv.includes('--history')) {
  const { spawnSync } = await import('node:child_process');
  const refs = process.argv.includes('--all-refs') ? ['--all'] : ['--remotes=origin'];
  const authors = spawnSync('git', ['log', ...refs, '--format=%an <%ae>'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  console.log(`commit authors: ${[...new Set(authors.stdout.split('\n').filter(Boolean))].join(', ')}`);
  const log = spawnSync('git', ['log', ...refs, '-p', '--no-color', '--unified=0', '--format=commit %H'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (log.status !== 0) {
    console.error(`check-secrets: git log failed: ${log.stderr}`);
    process.exit(2);
  }
  // Documentation ranges (RFC 5737), loopback, any-address, the public resolvers named in the docs.
  const harmlessIp = /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|127\.|0\.0\.0\.0$|255\.|1\.1\.1\.1$|8\.8\.8\.8$|8\.8\.4\.4$|9\.9\.9\.9$)/;
  const harmlessEmail = /@(example\.(com|org|net|invalid)|[a-z.-]*\.example|example\.invalid|anthropic\.com|users\.noreply\.github\.com)$/i;
  const secrets = [];
  const ips = new Map();
  const emails = new Map();
  let commit = '';
  let file = '';
  let commits = 0;
  let added = 0;
  const note = (map, value, where) => (map.has(value) ? map.get(value).count++ : map.set(value, { count: 1, first: where }));
  for (const line of log.stdout.split('\n')) {
    if (line.startsWith('commit ')) {
      commit = line.slice(7, 19);
      commits++;
      continue;
    }
    if (line.startsWith('+++ ')) {
      file = line.slice(6);
      continue;
    }
    if (!line.startsWith('+') || file.endsWith('pnpm-lock.yaml')) continue;
    added++;
    const where = `${commit} ${file}`;
    for (const [name, pattern] of PATTERNS) if (pattern.test(line)) secrets.push(`${where}: looks like a ${name}`);
    for (const m of line.matchAll(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g)) {
      const ip = m[1];
      if (ip.split('.').every((o) => Number(o) <= 255) && !harmlessIp.test(ip)) note(ips, ip, where);
    }
    for (const m of line.matchAll(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) if (!harmlessEmail.test(m[1])) note(emails, m[1], where);
  }
  console.log(`check-secrets --history: ${commits} commits, ${added} added lines`);
  for (const [title, map] of [
    ['IP addresses to look over', ips],
    ['email addresses to look over', emails],
  ]) {
    if (!map.size) continue;
    console.log(`${title}:`);
    for (const [value, { count, first }] of [...map].sort((a, b) => b[1].count - a[1].count)) console.log(`  ${value}  (${count} lines, first in ${first})`);
  }
  if (secrets.length) {
    console.error(`check-secrets --history: ${secrets.length} possible secret(s) in the history:`);
    for (const s of secrets) console.error(`  ${s}`);
    process.exit(1);
  }
  console.log('check-secrets --history: no secrets in any commit');
  process.exit(0);
}

const MIN_FILES = 40;
const files = textFiles().filter((f) => !f.endsWith('pnpm-lock.yaml'));
if (files.length < MIN_FILES) {
  console.error(`check-secrets: only ${files.length} text files found under ${ROOT}, expected at least ${MIN_FILES}. Refusing to pass.`);
  process.exit(2);
}

const problems = [];
for (const file of files) {
  if (ALLOWED.has(file)) continue;
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [name, pattern] of PATTERNS) {
      if (pattern.test(line)) problems.push(`${file}:${i + 1}: looks like a ${name}`);
    }
  });
}

if (problems.length) {
  console.error(`check-secrets: ${problems.length} possible secret(s). Move real values to secrets/ and read them with *_FILE.`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-secrets: ${files.length} files clean`);
