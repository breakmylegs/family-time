// What makes the build fail, and what only warns. The parent app adds one more check of its own:
// a (?) button can only name a topic id that exists, because the ids are a TypeScript type.
import type { Source, Topic } from './types.js';

/** Built from code points so this file never contains the characters it looks for. */
const DASHES = new RegExp(`[${String.fromCodePoint(0x2013)}${String.fromCodePoint(0x2014)}]`);
/** Help text names the child through placeholders, never a real name or a guessed pronoun. */
const PLACEHOLDERS = new Set(['{child}', '{they}', '{them}', '{their}', '{They}', '{Their}']);
const GENDERED = /\b(he|him|his|himself|she|her|hers|herself)\b/i;
/** The mock's sample children. Real names are never in the repo, so these are the ones to catch. */
const SAMPLE_NAMES = /\b(Ollie|Jamie)\b/;
const REVIEW_EVERY_MS = 365 * 24 * 3_600_000;

export interface Problems {
  errors: string[];
  warnings: string[];
}

function texts(t: Topic): string[] {
  return [t.title, t.evidenceNote ?? '', t.inShort, t.childSees ?? '', ...[t.howToUse, t.howItWorks, t.whyItHelps, t.watchOutFor, t.research].flatMap((x) => x ?? [])];
}

export function checkContent(topics: Topic[], sources: Source[], now: Date, files: Map<string, string> = new Map()): Problems {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(topics.map((t) => t.id));
  const sourceIds = new Set<string>();
  for (const s of sources) {
    if (sourceIds.has(s.id)) errors.push(`sources.yaml: ${s.id} appears twice`);
    sourceIds.add(s.id);
    for (const v of [s.citation, s.design, s.finding]) if (DASHES.test(v)) errors.push(`sources.yaml: ${s.id} has an em or en dash`);
  }

  for (const t of topics) {
    const where = files.get(t.id) ?? `${t.id}.md`;
    if (files.size && where !== `${t.id}.md`) errors.push(`${where}: the file name must be the id, ${t.id}.md`);
    if (!/^[a-z0-9-]+$/.test(t.id)) errors.push(`${where}: id must be lower case letters, digits and hyphens`);
    if (t.evidence) {
      if (!t.sources.length) errors.push(`${where}: an evidence badge needs at least one source`);
      if (!t.evidenceNote) errors.push(`${where}: an evidence badge needs its one line (evidenceNote)`);
      if (!t.whyItHelps) errors.push(`${where}: a topic with an evidence badge needs "Why it helps"`);
    } else if (t.evidenceNote) {
      errors.push(`${where}: evidenceNote without an evidence level`);
    }
    for (const s of t.sources) if (!sourceIds.has(s)) errors.push(`${where}: source ${s} is not in sources.yaml`);
    if (t.research && !t.sources.length) errors.push(`${where}: "The research" needs its sources listed`);
    for (const r of t.related) {
      if (!ids.has(r)) errors.push(`${where}: related topic ${r} does not exist`);
      if (r === t.id) errors.push(`${where}: a topic cannot be related to itself`);
    }
    for (const text of texts(t)) {
      if (DASHES.test(text)) errors.push(`${where}: em or en dash in "${text.slice(0, 60)}"`);
      const g = GENDERED.exec(text);
      if (g) errors.push(`${where}: "${g[0]}" guesses the child's pronouns. Write {child}, {they}, {them} or {their}`);
      const n = SAMPLE_NAMES.exec(text);
      if (n) errors.push(`${where}: "${n[0]}" is a child's name written in. Write {child}`);
      for (const p of text.match(/\{[^}]*\}/g) ?? []) if (!PLACEHOLDERS.has(p)) errors.push(`${where}: unknown placeholder ${p}`);
    }
    const reviewed = Date.parse(t.lastReviewed);
    if (Number.isNaN(reviewed)) errors.push(`${where}: lastReviewed must be a date like 2026-10-27`);
    else if (now.getTime() - reviewed > REVIEW_EVERY_MS) warnings.push(`${where}: not reviewed for over 12 months (last ${t.lastReviewed})`);
    if (t.status === 'needs-review') warnings.push(`${where}: needs review by the owner`);
  }
  return { errors, warnings };
}
