// Fails on an em dash or en dash in any text file: code, copy, docs, help content, the lot.
// Use "to" for ranges and a full stop or comma elsewhere.
//
//   node scripts/check-dashes.mjs              the whole repo
//   node scripts/check-dashes.mjs <file>...    just these files (the edit hook)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, textFiles } from './lib/walk.mjs';

// Built from code points so this file never contains the characters it looks for.
const DASHES = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);

// A whole-repo run that finds this few files is looking in the wrong place, not finding a clean tree.
const MIN_FILES = 40;

const args = process.argv.slice(2);
const files = args.length ? args : textFiles();
if (!args.length && files.length < MIN_FILES) {
  console.error(`check-dashes: only ${files.length} text files found under ${ROOT}, expected at least ${MIN_FILES}. Refusing to pass.`);
  process.exit(2);
}

const problems = [];
for (const file of files) {
  const lines = readFileSync(args.length ? file : join(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (DASHES.test(line)) problems.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}

if (problems.length) {
  console.error(`check-dashes: ${problems.length} line(s) with an em or en dash. Use "to" for ranges, otherwise a full stop or comma.`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-dashes: ${files.length} files clean`);
