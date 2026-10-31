// The weekly family summary (brief Part 13, feature 3): from totals only, never the child's own
// words or anything they typed, with names replaced on the way out and put back on the way in.
// Without AI, the same totals are written out from a template.
import { generateText, type LanguageModel } from 'ai';
import { pseudonyms } from './pseudonym.js';
import type { Usage } from './gateway.js';

export interface WeekTotals {
  childId: string;
  name: string;
  /** "7 h", "5 h 30". */
  allowance: string;
  left: string;
  used: string;
  jobsDone: number;
  /** "£1.20". */
  earned: string;
  bonus: string | null;
}

/** Without AI: the totals in a sentence or two, the same every week. */
export function templateSummary(t: WeekTotals): string {
  const jobs = t.jobsDone === 1 ? '1 job' : `${t.jobsDone} jobs`;
  return `${t.name} used ${t.used} of ${t.allowance} this week, with ${t.left} still to plan. ${jobs} done, earning ${t.earned}${t.bonus ? `, and ${t.bonus} of bonus for time saved` : ''}. Worth asking what went well.`;
}

export async function weeklySummary(model: LanguageModel, totals: WeekTotals): Promise<{ value: string; usage: Usage }> {
  const p = pseudonyms([{ id: totals.childId, name: totals.name }]);
  const result = await generateText({
    model,
    system: [
      'You write a short, warm note (at most three sentences) for a parent about their child\'s week of screen time and jobs, from totals only.',
      'Be encouraging and factual. No advice about punishment, no comparisons with other children, no medical or research claims.',
      'Use British English and 24-hour times. Refer to the child exactly as given.',
    ].join('\n'),
    prompt: `${p.labels[0]!.label}: allowance ${totals.allowance}, used ${totals.used}, left ${totals.left}, jobs done ${totals.jobsDone}, pocket money earned ${totals.earned}${totals.bonus ? `, bonus ${totals.bonus}` : ''}.`,
  });
  const usage = { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 };
  const text = p.show(result.text.trim()).slice(0, 600);
  return { value: text || templateSummary(totals), usage };
}
