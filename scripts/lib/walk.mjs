// Lists the repo's text files without git, so the checks run the same on the laptop and inside the
// image (which has no .git). Skips build output, dependencies, secrets and binary files.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.turbo', 'secrets', 'backups', '.deploy', '.state', 'coverage']);
const TEXT = new Set([
  '.md', '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.html', '.css',
  '.sh', '.sql', '.txt', '.caddy', '.service', '.sol', '.toml',
]);
const TEXT_NAMES = new Set(['Dockerfile', '.dockerignore', '.gitignore', '.gitattributes', '.npmrc', '.node-version']);

/**
 * Skills installed from other people's repositories (listed in skills-lock.json) are their text,
 * not ours, and no parent or child reads them. Skills we write are still checked.
 */
function vendoredSkillDirs(root) {
  const lock = join(root, 'skills-lock.json');
  if (!existsSync(lock)) return new Set();
  const names = Object.keys(JSON.parse(readFileSync(lock, 'utf8')).skills ?? {});
  return new Set(names.map((n) => join(root, '.claude', 'skills', n)));
}

export function textFiles(root = ROOT) {
  const out = [];
  const vendored = vendoredSkillDirs(root);
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !vendored.has(full)) walk(full);
      } else if (TEXT.has(extname(entry.name)) || TEXT_NAMES.has(entry.name)) {
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}
