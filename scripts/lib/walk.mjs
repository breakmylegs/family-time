// Lists the repo's text files without git, so the checks run the same on the laptop and inside the
// image (which has no .git). Skips build output, dependencies, secrets and binary files.
import { readdirSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.turbo', 'secrets', 'backups', '.deploy', '.state', 'coverage']);
const TEXT = new Set([
  '.md', '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.html', '.css',
  '.sh', '.sql', '.txt', '.caddy', '.service', '.sol', '.toml',
]);
const TEXT_NAMES = new Set(['Dockerfile', '.dockerignore', '.gitignore', '.gitattributes', '.npmrc', '.node-version']);

export function textFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (TEXT.has(extname(entry.name)) || TEXT_NAMES.has(entry.name)) {
        out.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}
