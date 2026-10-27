import { describe, expect, it } from 'vitest';
import { BEGIN, blockRules, clientNameFor, END, MarkerError, splitRules, withOurRules } from '../src/index.js';

const theirs = ['||ads.example^', '@@||bank.example^', '! a note of their own'];

describe('our block of user rules', () => {
  it('is added after everything else when there is none', () => {
    expect(withOurRules(theirs, ['||a.com^'])).toEqual([...theirs, BEGIN, '||a.com^', END]);
  });

  it('replaces only what is between the markers, keeping the order around it', () => {
    const rules = ['||first^', BEGIN, '||old.com^', END, '||last^'];
    expect(withOurRules(rules, ['||new.com^', '||new2.com^'])).toEqual(['||first^', BEGIN, '||new.com^', '||new2.com^', END, '||last^']);
    expect(withOurRules(rules, [])).toEqual(['||first^', BEGIN, END, '||last^']);
  });

  it('refuses to write when the markers are broken, and says how to fix it', () => {
    for (const bad of [
      [BEGIN, '||x^'],
      ['||x^', END],
      [BEGIN, END, BEGIN, END],
      [END, '||x^', BEGIN],
    ]) {
      expect(() => withOurRules(bad, [])).toThrow(MarkerError);
    }
    expect(() => splitRules([END, BEGIN])).toThrow(/wrong order/);
  });

  it('never touches a rule that only looks like ours', () => {
    const rules = [`  ${BEGIN}  `, '||ours^', END, `${END} (copied by hand)`];
    expect(splitRules(rules)).toEqual({ before: [], ours: ['||ours^'], after: [`${END} (copied by hand)`] });
  });
});

describe('block rules for custom services', () => {
  it('are one per domain, sorted, deduplicated, for this device only', () => {
    expect(blockRules('ft-abc123', ['Minecraft.net', 'mojang.com', 'minecraft.net'])).toEqual([
      "||mojang.com^$client='ft-abc123'",
      "||minecraft.net^$client='ft-abc123'",
    ].sort());
  });

  it('refuse anything that is not a plain domain, or a client name we did not make', () => {
    expect(() => blockRules('ft-abc', ["evil.com^$client='x'"])).toThrow(/not a domain/);
    expect(() => blockRules('ft-abc', ['localhost'])).toThrow(/not a domain/);
    expect(() => blockRules("ft-a'b", ['a.com'])).toThrow(/client name/);
  });

  it('name devices safely', () => {
    expect(clientNameFor('9b1f6c2e-0d4a-4f5e-9a3b-1c2d3e4f5a6b')).toBe('ft-9b1f6c2e0d4a');
  });
});
