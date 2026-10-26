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
