// The AI package with a mock model (no provider, no key, no network): the gateway's checks in
// order and its audit, the key crypto, names never leaving, and each feature checking what the
// model says before anything becomes a card.
import { randomBytes } from 'node:crypto';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_IDEAS,
  costCentipence,
  invoke,
  masterKeyFrom,
  NoMasterKey,
  open,
  proposeControl,
  pseudonyms,
  seal,
  suggestJobs,
  templateSummary,
  weeklySummary,
  type CallRecord,
  type GatewayConfig,
} from '../src/index.js';

/** A model that answers with `text` and counts 100 tokens in, 20 out. */
function answering(text: string) {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
      warnings: [],
    }),
  });
  return model;
}

const config = (over: Partial<GatewayConfig> = {}): GatewayConfig => ({
  on: true,
  features: { control: { on: true, provider: 'anthropic', model: 'claude-haiku-5-5', monthlyCapPence: 100, levelTwo: true } },
  allowedModels: () => ['claude-haiku-5-5'],
  ...over,
});

function deps(c: GatewayConfig, spent = 0) {
  const records: CallRecord[] = [];
  return { records, deps: { config: async () => c, spent: async () => spent, record: async (r: CallRecord) => void records.push(r), cost: costCentipence } };
}

describe('the gateway', () => {
  const call = async () => ({ value: 'done', usage: { inputTokens: 1000, outputTokens: 200 } });

  it('calls when every check passes, and audits the call with its cost', async () => {
    const d = deps(config());
    expect(await invoke(d.deps, 'control', call)).toMatchObject({ ok: true, value: 'done', provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(d.records).toEqual([{ feature: 'control', provider: 'anthropic', model: 'claude-haiku-5-5', outcome: 'ok', inputTokens: 1000, outputTokens: 200, costCentipence: 16, level: 2 }]);
  });

  it('refuses in order, cheapest check first, and audits each refusal', async () => {
    const cases: [GatewayConfig, number, string][] = [
      [config({ on: false }), 0, 'ai_off'],
      [config({ features: {} }), 0, 'feature_off'],
      [config({ features: { control: { on: true, provider: null, model: null, monthlyCapPence: 100, levelTwo: true } } }), 0, 'no_provider'],
      // Plain-English control is level 2: it needs level 2 switched on for a cloud provider.
      [config({ features: { control: { on: true, provider: 'anthropic', model: 'claude-haiku-5-5', monthlyCapPence: 100, levelTwo: false } } }), 0, 'level_not_allowed'],
      [config({ allowedModels: () => [] }), 0, 'model_not_allowed'],
      [config(), 100 * 100, 'cap_reached'],
    ];
    for (const [c, spent, refusal] of cases) {
      const d = deps(c, spent);
      const r = await invoke(d.deps, 'control', call);
      expect(r).toMatchObject({ ok: false, refusal });
      expect(d.records[0]!.outcome).toBe(refusal);
    }
  });

  it('lets level 2 go to a local model without the switch', async () => {
    const d = deps(config({ features: { control: { on: true, provider: 'ollama', model: 'llama3.2', monthlyCapPence: 0, levelTwo: false } }, allowedModels: () => ['llama3.2'] }), 0);
    // A cap of 0 still refuses: the owner set it so.
    expect(await invoke(d.deps, 'control', call)).toMatchObject({ ok: false, refusal: 'cap_reached' });
  });

  it('turns a provider failure into a refusal, never a throw', async () => {
    const d = deps(config());
    expect(await invoke(d.deps, 'control', async () => Promise.reject(new Error('timeout')))).toMatchObject({ ok: false, refusal: 'provider_failed' });
  });
});

describe('keys at rest', () => {
  const key = randomBytes(32);

  it('seals and opens, and a sealed key cannot be moved to another setting', () => {
    const sealed = seal(key, 'sk-ant-secret-1234', 'anthropic');
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('secret');
    expect(open(key, sealed, 'anthropic')).toBe('sk-ant-secret-1234');
    expect(() => open(key, sealed, 'openai')).toThrow();
    expect(() => open(randomBytes(32), sealed, 'anthropic')).toThrow();
  });

  it('fails closed without a proper master key', () => {
    expect(() => masterKeyFrom(undefined)).toThrow(NoMasterKey);
    expect(() => masterKeyFrom('short')).toThrow(NoMasterKey);
    expect(masterKeyFrom('ab'.repeat(32))).toHaveLength(32);
  });
});

describe("children's names", () => {
  it('never leave, and come back', () => {
    const p = pseudonyms([
      { id: 'a', name: 'Ollie' },
      { id: 'b', name: 'Jamie' },
    ]);
    expect(p.hide('Let Ollie have YouTube, and jamie too')).toBe('Let Child A have YouTube, and Child B too');
    expect(p.show('Child A can play')).toBe('Ollie can play');
    expect(p.idOf('Child B')).toBe('b');
  });

  it('never leave when they have accents, either', () => {
    const p = pseudonyms([
      { id: 'z', name: 'Zoë' },
      { id: 'c', name: 'Chloé' },
      { id: 'a', name: 'Åsa' },
    ]);
    expect(p.hide('Let Zoë have YouTube, Chloé can have Roblox, and åsa wants Minecraft')).toBe('Let Child A have YouTube, Child B can have Roblox, and Child C wants Minecraft');
  });
});

describe('plain-English control', () => {
  const children = [{ id: 'ollie', name: 'Ollie' }];
  const targets = [{ kind: 'service' as const, id: 'yt', name: 'YouTube' }];

  it('makes a card from the family own apps, and never sends the name', async () => {
    const model = answering(JSON.stringify({ action: 'allow', child: 'Child A', target: 'YouTube', duration: '1h', why: 'Child A gets an hour.' }));
    const r = await proposeControl(model, { text: 'Let Ollie have YouTube for an hour', children, targets, today: 'Monday 18:32' });
    expect(r.value.drafts).toEqual([{ childId: 'ollie', request: { target: { kind: 'service', id: 'yt' }, type: 'allow', duration: '1h', countsAgainstAllowance: true }, summary: 'Allow YouTube for Ollie for an hour' }]);
    expect(r.value.note).toBe('Ollie gets an hour.');
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain('Ollie');
  });

  it('refuses an app the family does not have, and anything off the subject', async () => {
    const r1 = await proposeControl(answering(JSON.stringify({ action: 'allow', child: 'Child A', target: 'TikTok', duration: '1h', why: '' })), { text: 'tiktok', children, targets, today: 'x' });
    expect(r1.value.drafts).toEqual([]);
    const r2 = await proposeControl(answering(JSON.stringify({ action: 'none', child: 'all', target: null, duration: '30m', why: '' })), { text: 'what is for tea', children, targets, today: 'x' });
    expect(r2.value.drafts).toEqual([]);
  });
});

describe('job ideas and the summary', () => {
  it('drops ideas the family already has, and falls back when none are left', async () => {
    const r = await suggestJobs(answering(JSON.stringify({ ideas: [{ title: 'Set the table', picture: 'dishes', rewardType: 'money', amount: 20 }] })), { ageBands: ['8-10'], existing: ['Set the table'], month: 'November', weather: null });
    expect(r.value).toEqual(FALLBACK_IDEAS);
  });

  it('writes the summary with the name put back, or from the template', async () => {
    const totals = { childId: 'o', name: 'Ollie', allowance: '7 h', left: '1 h', used: '6 h', jobsDone: 3, earned: '£1.20', bonus: '20p' };
    expect((await weeklySummary(answering('Child A had a steady week.'), totals)).value).toBe('Ollie had a steady week.');
    expect(templateSummary(totals)).toBe('Ollie used 6 h of 7 h this week, with 1 h still to plan. 3 jobs done, earning £1.20, and 20p of bonus for time saved. Worth asking what went well.');
  });
});
