// For other packages' tests: a model that answers with fixed text, so no provider, key or network
// is ever needed to test a feature. Not used by the app itself.
import { MockLanguageModelV4 } from 'ai/test';

/** A model that answers every call with the next of `answers` (the last one repeats), 100 tokens in and 20 out. */
export function answeringModel(...answers: string[]) {
  let n = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: answers[Math.min(n++, answers.length - 1)] ?? '' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
      warnings: [],
    }),
  });
}
