// Plain-English control (brief Part 13, feature 1): "let him have YouTube until tea" becomes a
// proposal card to approve. The model only fills in a small form; every answer is checked against
// the family's own children, apps and groups, and the durations Control already offers, before a
// card exists. Nothing here acts: a parent's tap does, through Control's own commands.
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import { asData, pseudonyms } from './pseudonym.js';
import type { Usage } from './gateway.js';

const DURATIONS = ['30m', '1h', 'until-bedtime', 'until-tomorrow'] as const;

const Plan = z.object({
  action: z.enum(['allow', 'block', 'pause', 'none']).describe('none: the request is not about allowing, blocking or pausing'),
  child: z.string().describe('"Child A", "Child B", or "all"'),
  target: z.string().nullable().describe('An app or group name from the list, exactly; null for pause'),
  duration: z.enum(DURATIONS),
  why: z.string().max(200).describe('One short sentence for the parent'),
});

export interface ControlTarget {
  kind: 'service' | 'group';
  id: string;
  name: string;
}

/** A card to approve: a Control override for one child, with words for the card. */
export interface ControlDraft {
  childId: string;
  request: { target: { kind: 'service'; id: string } | { kind: 'group'; id: string } | { kind: 'everything' }; type: 'allow' | 'block' | 'pause'; duration: (typeof DURATIONS)[number]; countsAgainstAllowance: boolean };
  summary: string;
}

export type ControlResult = { drafts: ControlDraft[]; note: string } | { drafts: []; note: string };

const LABEL: Record<(typeof DURATIONS)[number], string> = { '30m': 'for 30 minutes', '1h': 'for an hour', 'until-bedtime': 'until bedtime', 'until-tomorrow': 'until tomorrow morning' };

/** Asks the model for a plan, then checks it. Returns drafts, or a note saying why there are none. */
export async function proposeControl(
  model: LanguageModel,
  input: { text: string; children: { id: string; name: string }[]; targets: ControlTarget[]; today: string },
): Promise<{ value: ControlResult; usage: Usage }> {
  const p = pseudonyms(input.children);
  const result = await generateText({
    model,
    output: Output.object({ schema: Plan }),
    system: [
      'You turn a parent\'s request about their children\'s screen time into one small form.',
      'You never act; a parent approves the result. Use only the apps, groups and children listed.',
      'Choose the closest duration on offer. If the request is not about allowing, blocking or pausing screen time, answer action "none".',
      `Children: ${p.labels.map((l) => l.label).join(', ')}.`,
      `Apps and groups: ${input.targets.map((t) => t.name).join(', ')}.`,
      `Today: ${input.today}.`,
    ].join('\n'),
    // What the parent typed is data, not instructions.
    prompt: asData('request', p.hide(input.text)),
  });
  const usage = { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 };
  const plan = result.output;
  if (!plan || plan.action === 'none') return { value: { drafts: [], note: "That doesn't sound like allowing, blocking or pausing. Try something like \"YouTube until tea\"." }, usage };

  const childIds = plan.child.trim().toLowerCase() === 'all' ? input.children.map((c) => c.id) : [p.idOf(plan.child)].filter((x): x is string => Boolean(x));
  if (!childIds.length) return { value: { drafts: [], note: "I couldn't tell which child that's for. Try adding their name." }, usage };

  let target: ControlDraft['request']['target'] = { kind: 'everything' };
  let targetName = 'everything';
  if (plan.action !== 'pause') {
    const t = input.targets.find((x) => x.name.toLowerCase() === (plan.target ?? '').trim().toLowerCase());
    if (!t) return { value: { drafts: [], note: "I couldn't match that to one of your apps or groups. Try its name as it shows on Control." }, usage };
    target = { kind: t.kind, id: t.id };
    targetName = t.name;
  }
  const verb = plan.action === 'allow' ? 'Allow' : plan.action === 'block' ? 'Block' : 'Pause';
  const drafts = childIds.map((childId) => {
    const name = input.children.find((c) => c.id === childId)!.name;
    return {
      childId,
      request: { target, type: plan.action as 'allow' | 'block' | 'pause', duration: plan.duration, countsAgainstAllowance: true },
      summary: plan.action === 'pause' ? `Pause everything for ${name} ${LABEL[plan.duration]}` : `${verb} ${targetName} for ${name} ${LABEL[plan.duration]}`,
    };
  });
  return { value: { drafts, note: p.show(plan.why) }, usage };
}
