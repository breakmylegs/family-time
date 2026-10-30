// A deliberately small parser for our own files: frontmatter of `key: value` and `key: [a, b]`,
// `## ` sections of paragraphs or a numbered list, and a sources file that is a YAML list of flat
// maps. Anything outside that shape is an error, so a typo cannot silently drop text.
import { EVIDENCE, SECTIONS, type Evidence, type SectionName, type Source, type Topic } from './types.js';

export class ContentError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
  }
}

function frontmatter(file: string, text: string): { fields: Map<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) throw new ContentError(file, 'must start with frontmatter between --- lines');
  const fields = new Map<string, string | string[]>();
  for (const raw of m[1]!.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const kv = /^([a-zA-Z]+):\s*(.*)$/.exec(line);
    if (!kv) throw new ContentError(file, `cannot read frontmatter line "${line}"`);
    const value = kv[2]!.trim();
    const list = /^\[(.*)\]$/.exec(value);
    fields.set(
      kv[1]!,
      list
        ? list[1]!
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : value,
    );
  }
  return { fields, body: m[2]! };
}

function paragraphs(lines: string[]): string[] {
  return lines
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

function steps(file: string, lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^\d+\.\s+(.*)$/.exec(line);
    if (m) out.push(m[1]!);
    else if (out.length) out[out.length - 1] += ` ${line}`;
    else throw new ContentError(file, '"How to use it" must be a numbered list');
  }
  return out;
}

export function parseTopic(file: string, text: string): Topic {
  const { fields, body } = frontmatter(file, text);
  const str = (key: string, required = true): string => {
    const v = fields.get(key);
    if (v === undefined || v === '') {
      if (required) throw new ContentError(file, `frontmatter needs ${key}`);
      return '';
    }
    if (Array.isArray(v)) throw new ContentError(file, `${key} must be a single value`);
    return v;
  };
  const list = (key: string): string[] => {
    const v = fields.get(key);
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw new ContentError(file, `${key} must be a list like [a, b]`);
    return v;
  };

  const evidenceRaw = str('evidence');
  if (evidenceRaw !== 'none' && !(EVIDENCE as readonly string[]).includes(evidenceRaw)) {
    throw new ContentError(file, `evidence must be strong, moderate, early or none, not "${evidenceRaw}"`);
  }
  const status = str('status');
  if (status !== 'reviewed' && status !== 'needs-review') throw new ContentError(file, 'status must be reviewed or needs-review');

  const sections = new Map<SectionName, string[]>();
  const order: SectionName[] = [];
  let current: string[] | undefined;
  for (const line of body.split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      const name = h[1]!.trim() as SectionName;
      if (!SECTIONS.includes(name)) throw new ContentError(file, `unknown section "${name}". Use one of: ${SECTIONS.join(', ')}`);
      if (sections.has(name)) throw new ContentError(file, `section "${name}" appears twice`);
      current = [];
      sections.set(name, current);
      order.push(name);
      continue;
    }
    if (/^#/.test(line)) throw new ContentError(file, `only ## headings are allowed, found "${line.trim()}"`);
    if (!current) {
      if (line.trim()) throw new ContentError(file, 'text before the first ## section');
      continue;
    }
    current.push(line);
  }
  const ranks = order.map((n) => SECTIONS.indexOf(n));
  if (ranks.some((r, i) => i > 0 && r < ranks[i - 1]!)) throw new ContentError(file, `sections are out of order. The order is: ${SECTIONS.join(', ')}`);

  const para = (name: SectionName) => {
    const lines = sections.get(name);
    if (!lines) return null;
    const p = paragraphs(lines);
    if (!p.length) throw new ContentError(file, `section "${name}" is empty`);
    return p;
  };
  const inShort = para('In short');
  if (!inShort) throw new ContentError(file, 'every topic needs "In short"');
  const sees = para('What {child} sees');
  const how = sections.get('How to use it');

  return {
    id: str('id'),
    title: str('title'),
    evidence: evidenceRaw === 'none' ? null : (evidenceRaw as Evidence),
    evidenceNote: str('evidenceNote', false) || null,
    sources: list('sources'),
    lastReviewed: str('lastReviewed'),
    related: list('related'),
    status,
    inShort: inShort.join(' '),
    howToUse: how ? steps(file, how) : null,
    howItWorks: para('How it works'),
    whyItHelps: para('Why it helps'),
    childSees: sees ? sees.join(' ') : null,
    watchOutFor: para('Watch out for'),
    research: para('The research'),
  };
}

/** `sources.yaml`: a list of maps, each `- id: ...` then indented `key: value` lines. */
export function parseSources(file: string, text: string): Source[] {
  const out: Record<string, string>[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^-\s+([a-z]+):\s*(.*)$/.exec(raw);
    const field = /^\s{2}([a-z]+):\s*(.*)$/.exec(raw);
    const unquote = (v: string) => v.trim().replace(/^"(.*)"$/, '$1');
    if (item) out.push({ [item[1]!]: unquote(item[2]!) });
    else if (field && out.length) out[out.length - 1]![field[1]!] = unquote(field[2]!);
    else throw new ContentError(file, `cannot read line "${raw.trim()}"`);
  }
  return out.map((s) => {
    for (const key of ['id', 'citation', 'design', 'finding']) if (!s[key]) throw new ContentError(file, `source ${s.id ?? '?'} needs ${key}`);
    return { id: s.id!, citation: s.citation!, design: s.design!, finding: s.finding! };
  });
}
