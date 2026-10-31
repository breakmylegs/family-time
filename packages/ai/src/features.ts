// The AI features (brief Part 13, ADR 0016): a closed list. Each declares what it sends, whether
// it can propose actions, its monthly cap and what happens without AI. A new feature ships off.

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'mistral' | 'bedrock' | 'ollama';
export type FeatureId = 'control' | 'suggestions' | 'summary';

/**
 * 1: sent freely (task titles, service names, totals). 2: only when switched on for the feature,
 * with children's names replaced. 3: photos, DNS logs, a child's own answers: never to a cloud
 * provider, only to a local model (Ollama).
 */
export type DataLevel = 1 | 2 | 3;

export interface Feature {
  id: FeatureId;
  title: string;
  /** For Settings: what it does, in a sentence. */
  does: string;
  /** What it sends, for Settings, in plain words. */
  sends: string;
  level: DataLevel;
  /** True: its result becomes a proposal card a parent approves. Never an action by itself. */
  proposes: boolean;
  /** What a parent gets with the feature off, or when a call is refused. */
  fallback: string;
  /** Default spend limit a month, in pence. Owners can lower or raise it. */
  monthlyCapPence: number;
}

export const FEATURES: Record<FeatureId, Feature> = {
  control: {
    id: 'control',
    title: 'Plain-English control',
    does: 'Type what you want, like "YouTube until tea", and get a card to approve.',
    sends: "What you type, your app and group names, today's times. Children's names are replaced by Child A, Child B.",
    level: 2,
    proposes: true,
    fallback: 'Use Allow, Block and Pause on Control as usual.',
    monthlyCapPence: 100,
  },
  suggestions: {
    id: 'suggestions',
    title: 'Job ideas',
    does: "Suggests jobs to add, for your children's ages, the season and the weather.",
    sends: "Your children's age bands, the jobs you already have, the date and the weather forecast.",
    level: 1,
    proposes: false,
    fallback: 'A list of jobs that suit most ages.',
    monthlyCapPence: 50,
  },
  summary: {
    id: 'summary',
    title: 'Weekly summary',
    does: 'A short note on how the week went, for the family review.',
    sends: "Totals only: time planned and left, jobs done, pocket money earned. Children's names are replaced.",
    level: 1,
    proposes: false,
    fallback: 'The same totals, written out from a template.',
    monthlyCapPence: 50,
  },
};

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

/** Whether a provider may receive a feature's data. Level 3 only ever goes to a local model. */
export function levelAllowed(level: DataLevel, provider: ProviderId, levelTwoOn: boolean): boolean {
  if (level === 3) return provider === 'ollama';
  if (level === 2) return levelTwoOn || provider === 'ollama';
  return true;
}
