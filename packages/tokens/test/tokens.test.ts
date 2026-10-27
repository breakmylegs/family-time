// The tokens must match the mock, and the dark values must be the same in both places they live
// (the OS dark setting and the forced data-theme='dark'), or one of the two drifts unnoticed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'tokens.css'), 'utf8');
const mock = readFileSync(join(here, '..', '..', '..', 'docs', 'design', 'mock-screens.html'), 'utf8');

/** `--name: value` pairs in a block of CSS, values normalised (lower case, no spaces). */
function vars(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.replace(/\s+/g, '').toLowerCase());
  return out;
}

/** The text between the first `{` after `start` and its matching `}`. */
function block(text: string, start: string): string {
  const at = text.indexOf(start);
  if (at === -1) throw new Error(`no ${start}`);
  let depth = 0;
  for (let i = text.indexOf('{', at); i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(text.indexOf('{', at) + 1, i);
  }
  throw new Error(`unclosed ${start}`);
}

/** Compares numbers by value, so `.10` and `0.1` are the same. Hex is mangled identically on both sides. */
const colour = (v: string) => v.replace(/\d*\.?\d+/g, (n) => String(parseFloat(n)));

describe('tokens', () => {
  const light = vars(block(css, ':root {'));
  const darkOs = vars(block(block(css, '@media (prefers-color-scheme: dark)'), ":root:not([data-theme='light'])"));
  const darkForced = vars(block(css, ":root[data-theme='dark']"));

  it('has a real set of tokens', () => {
    expect(light.size).toBeGreaterThanOrEqual(50);
    expect(darkOs.size).toBeGreaterThanOrEqual(45);
  });

  it('keeps the two dark copies identical', () => {
    expect([...darkForced]).toEqual([...darkOs]);
  });

  it('matches the mock, light and dark', () => {
    const mockLight = vars(block(mock, ':root{'));
    const mockDark = vars(block(mock, ':root[data-theme="dark"]{'));
    let compared = 0;
    for (const [name, value] of light) {
      const m = mockLight.get(name);
      if (m === undefined) continue;
      expect(colour(value), name).toBe(colour(m));
      compared++;
    }
    for (const [name, value] of darkOs) {
      const m = mockDark.get(name);
      if (m === undefined) continue;
      expect(colour(value), `dark ${name}`).toBe(colour(m));
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(90);
  });
});
