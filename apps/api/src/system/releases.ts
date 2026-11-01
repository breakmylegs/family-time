// Release notes from CHANGELOG.md (brief Part 15), read once at boot. The image carries the file at
// its root; in development it is found by walking up from here.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Release } from '@family-time/schemas';

/** `## 0.9.0 (Phase 8, ready for the pilot)` then `- ` lines, newest first. */
export function parseChangelog(text: string): Release[] {
  const out: Release[] = [];
  for (const line of text.split(/\r?\n/)) {
    const head = /^##\s+(\S+)(?:\s+\((.*)\))?\s*$/.exec(line);
    if (head) out.push({ version: head[1]!, title: head[2] ?? '', notes: [] });
    else if (line.startsWith('- ') && out.length) out[out.length - 1]!.notes.push(line.slice(2).trim());
  }
  return out;
}

function findUp(name: string, from: string): string | undefined {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

let cached: Release[] | undefined;

export function releases(): Release[] {
  if (cached) return cached;
  const file = findUp('CHANGELOG.md', dirname(fileURLToPath(import.meta.url)));
  cached = file ? parseChangelog(readFileSync(file, 'utf8')) : [];
  return cached;
}
