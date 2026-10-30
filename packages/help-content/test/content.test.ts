import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/build.js';
import { checkContent } from '../src/check.js';
import { ContentError, parseSources, parseTopic } from '../src/parse.js';
import { forChild } from '../src/render.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-10-30T12:00:00Z');

const topic = (front: Record<string, string>, body: string) =>
  `---\n${Object.entries({ id: 't', title: 'T', evidence: 'none', lastReviewed: '2026-10-30', status: 'reviewed', ...front })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n\n${body}`;

describe('the help content in this repo', () => {
  const { topics, sources, files } = loadContent(root);

  it('passes every check', () => {
    const { errors } = checkContent(topics, sources, NOW, files);
    expect(errors).toEqual([]);
  });

  it("has the brief's seed topics with their evidence levels, exactly", () => {
    const level = Object.fromEntries(topics.map((t) => [t.id, t.evidence]));
    expect(level).toMatchObject({
      'unused-time-bonus': 'moderate',
      'weekly-allowance': 'moderate',
      'gradual-reduction': 'moderate',
      'pause-everything': 'moderate',
      'allow-block-normal': null,
      'praise-not-prizes': 'strong',
      'earning-screen-time': 'moderate',
    });
  });

  it('marks every topic beyond the seed text as needing review', () => {
    const reviewed = topics.filter((t) => t.status === 'reviewed').map((t) => t.id);
    expect(reviewed.sort()).toEqual(['allow-block-normal', 'gradual-reduction', 'pause-everything', 'praise-not-prizes', 'unused-time-bonus', 'weekly-allowance']);
  });

  it('reads a seed topic into its sections', () => {
    const pause = topics.find((t) => t.id === 'pause-everything')!;
    expect(pause.inShort).toBe('Stops managed apps on {their} devices, within about a minute.');
    expect(pause.howToUse).toEqual(['Tap Pause everything.', 'Choose how long, or until you resume.', "Tap Resume now when you're done."]);
    expect(pause.evidenceNote).toBe('Studies that observed families, rather than trials.');
  });
});

describe('the checks', () => {
  const sources = parseSources('s', '- id: a\n  citation: A\n  design: D\n  finding: F\n');
  const check = (text: string) => checkContent([parseTopic('t.md', text)], sources, NOW).errors;

  it('fail an evidence badge with no source', () => {
    expect(check(topic({ evidence: 'moderate', evidenceNote: 'One trial.' }, '## In short\n\nX.\n\n## Why it helps\n\nY.\n'))).toEqual([
      't.md: an evidence badge needs at least one source',
    ]);
  });

  it('fail a source that is not in sources.yaml, and a related topic that does not exist', () => {
    expect(check(topic({ sources: '[nope]', related: '[missing]' }, '## In short\n\nX.\n'))).toEqual([
      't.md: source nope is not in sources.yaml',
      't.md: related topic missing does not exist',
    ]);
  });

  it("fail a child's name or a guessed pronoun written in", () => {
    expect(check(topic({}, '## In short\n\nOllie plans his week.\n'))).toEqual([
      `t.md: "his" guesses the child's pronouns. Write {child}, {they}, {them} or {their}`,
      `t.md: "Ollie" is a child's name written in. Write {child}`,
    ]);
  });

  it('fail an em or en dash', () => {
    const dash = String.fromCodePoint(0x2014);
    expect(check(topic({}, `## In short\n\nA ${dash} B.\n`))[0]).toMatch(/em or en dash/);
  });

  it('warn when a topic has not been reviewed for 12 months', () => {
    const { warnings } = checkContent([parseTopic('t.md', topic({ lastReviewed: '2025-09-01' }, '## In short\n\nX.\n'))], sources, NOW);
    expect(warnings).toEqual(['t.md: not reviewed for over 12 months (last 2025-09-01)']);
  });

  it('refuse sections out of order, unknown sections, and text outside a section', () => {
    expect(() => parseTopic('t.md', topic({}, '## Watch out for\n\nX.\n\n## In short\n\nY.\n'))).toThrow(/out of order/);
    expect(() => parseTopic('t.md', topic({}, '## Background\n\nX.\n'))).toThrow(ContentError);
    expect(() => parseTopic('t.md', topic({}, 'Loose text.\n\n## In short\n\nX.\n'))).toThrow(/before the first/);
  });
});

describe('forChild', () => {
  it("puts in the child's name and pronouns, they by default", () => {
    const text = '{They} saved time. Praise {their} choice and tell {them}, {child}.';
    expect(forChild(text, { name: 'Ollie', pronouns: 'he' })).toBe('He saved time. Praise his choice and tell him, Ollie.');
    expect(forChild(text, { name: 'Ada', pronouns: 'she' })).toBe('She saved time. Praise her choice and tell her, Ada.');
    expect(forChild(text, { name: 'Sam' })).toBe('They saved time. Praise their choice and tell them, Sam.');
  });
});
