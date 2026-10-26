// PostToolUse hook after Edit or Write. One process for every check, because each process start
// costs seconds on the Windows laptop:
//   1. dash check on the edited file (any text file)
//   2. contracts/: forge fmt and forge test, when Foundry is installed
//   3. a TypeScript package: typecheck that package and run the tests related to the file
// Exit 2 sends the failure back to Claude to fix.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path;
if (!file || !existsSync(file)) process.exit(0);

const root = resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || '.');
const abs = resolve(file);
const rel = relative(root, abs).split(sep).join('/');
if (rel.startsWith('..')) process.exit(0);

const problems = [];
// On Windows, corepack and forge are .cmd shims that need a shell, so the command line is built
// here with every argument quoted, rather than handing the shell unescaped arguments.
const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const run = (cmd, args, cwd = root) => {
  const options = { cwd, encoding: 'utf8', timeout: 240_000 };
  const r =
    process.platform === 'win32'
      ? spawnSync([cmd, ...args].map(quote).join(' '), { ...options, shell: true })
      : spawnSync(cmd, args, options);
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};

// 1. Dashes, in-process.
const TEXT = /\.(md|ts|tsx|mts|js|mjs|cjs|json|ya?ml|html|css|sh|sql|txt|caddy|service|sol|toml)$/;
if (TEXT.test(rel) || /(^|\/)Dockerfile$/.test(rel)) {
  const dashes = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
  readFileSync(abs, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (dashes.test(line)) problems.push(`${rel}:${i + 1} has an em or en dash. Use "to" for ranges, otherwise a full stop or comma.`);
    });
}

// 2. Contracts.
if (rel.startsWith('contracts/') && run('forge', ['--version']).ok) {
  const fmt = run('forge', ['fmt'], join(root, 'contracts'));
  if (!fmt.ok) problems.push(`forge fmt failed:\n${fmt.out.slice(-2000)}`);
  const test = run('forge', ['test'], join(root, 'contracts'));
  if (!test.ok) problems.push(`forge test failed:\n${test.out.slice(-3000)}`);
}

// 3. TypeScript: find the package that owns the file.
if (['.ts', '.tsx', '.mts'].includes(extname(rel))) {
  let dir = dirname(abs);
  while (dir.startsWith(root) && !existsSync(join(dir, 'package.json'))) dir = dirname(dir);
  if (dir !== root && existsSync(join(dir, 'tsconfig.json'))) {
    const tsc = run('corepack', ['pnpm', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'], dir);
    if (!tsc.ok) problems.push(`typecheck failed in ${relative(root, dir)}:\n${tsc.out.slice(-3000)}`);
    const tests = run('corepack', ['pnpm', 'exec', 'vitest', 'related', '--run', '--passWithNoTests', abs], dir);
    if (!tests.ok) problems.push(`tests failed in ${relative(root, dir)}:\n${tests.out.slice(-3000)}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n\n'));
  process.exit(2);
}
