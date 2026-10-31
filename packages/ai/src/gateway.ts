// The one way to call a model (brief Part 13, reuse report 3): checks run cheapest first, and a
// refusal is a result, never a throw, so every feature falls back cleanly. Every call and every
// refusal is audited; prompts and replies are not kept.
import { FEATURES, levelAllowed, type FeatureId, type ProviderId } from './features.js';

export type Refusal = 'unknown_feature' | 'ai_off' | 'feature_off' | 'no_provider' | 'level_not_allowed' | 'model_not_allowed' | 'cap_reached' | 'provider_failed';

export interface FeatureSetting {
  on: boolean;
  provider: ProviderId | null;
  model: string | null;
  monthlyCapPence: number;
  /** Data level 2 switched on for this feature. */
  levelTwo: boolean;
}

export interface GatewayConfig {
  /** The owner's master switch. Off: no feature calls anything. */
  on: boolean;
  features: Partial<Record<FeatureId, FeatureSetting>>;
  /** The models each provider may use, from the provider registry and the owner's keys. */
  allowedModels: (provider: ProviderId) => string[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CallRecord {
  feature: FeatureId;
  provider: ProviderId | null;
  model: string | null;
  outcome: 'ok' | Refusal;
  inputTokens: number;
  outputTokens: number;
  /** Estimated, in hundredths of a penny. */
  costCentipence: number;
  level: number;
}

export interface GatewayDeps {
  config: () => Promise<GatewayConfig>;
  /** Spent this calendar month on a feature, in hundredths of a penny. */
  spent: (feature: FeatureId) => Promise<number>;
  record: (r: CallRecord) => Promise<void>;
  /** Estimated cost of a call, in hundredths of a penny, from the provider registry's prices. */
  cost: (provider: ProviderId, model: string, usage: Usage) => number;
}

export type Invoked<T> = { ok: true; value: T; provider: ProviderId; model: string } | { ok: false; refusal: Refusal; message: string };

const WORDS: Record<Refusal, string> = {
  unknown_feature: 'That is not one of the AI features.',
  ai_off: 'AI is switched off. The owner can switch it on in Settings.',
  feature_off: 'This AI feature is switched off. The owner can switch it on in Settings.',
  no_provider: 'This AI feature has no provider set up yet. The owner can choose one in Settings.',
  level_not_allowed: "This feature's data can't go to that provider. The owner can choose another in Settings.",
  model_not_allowed: 'That model is not on the list for this provider.',
  cap_reached: "This feature has reached this month's spending limit. It starts again next month.",
  provider_failed: "The AI provider didn't answer. Try again in a minute.",
};

/**
 * Runs `call` with the feature's provider and model if every check passes. `call` gets the
 * provider and model, does the request, and returns its value and token usage.
 */
export async function invoke<T>(deps: GatewayDeps, feature: FeatureId, call: (provider: ProviderId, model: string) => Promise<{ value: T; usage: Usage }>): Promise<Invoked<T>> {
  const def = FEATURES[feature];
  const refuse = async (refusal: Refusal, provider: ProviderId | null = null, model: string | null = null): Promise<Invoked<T>> => {
    await deps.record({ feature, provider, model, outcome: refusal, inputTokens: 0, outputTokens: 0, costCentipence: 0, level: def?.level ?? 0 });
    return { ok: false, refusal, message: WORDS[refusal] };
  };
  if (!def) return { ok: false, refusal: 'unknown_feature', message: WORDS.unknown_feature };
  const config = await deps.config();
  if (!config.on) return refuse('ai_off');
  const s = config.features[feature];
  if (!s?.on) return refuse('feature_off');
  if (!s.provider || !s.model) return refuse('no_provider');
  if (!levelAllowed(def.level, s.provider, s.levelTwo)) return refuse('level_not_allowed', s.provider, s.model);
  if (!config.allowedModels(s.provider).includes(s.model)) return refuse('model_not_allowed', s.provider, s.model);
  if ((await deps.spent(feature)) >= s.monthlyCapPence * 100) return refuse('cap_reached', s.provider, s.model);
  try {
    const { value, usage } = await call(s.provider, s.model);
    const costCentipence = deps.cost(s.provider, s.model, usage);
    await deps.record({ feature, provider: s.provider, model: s.model, outcome: 'ok', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costCentipence, level: def.level });
    return { ok: true, value, provider: s.provider, model: s.model };
  } catch {
    return refuse('provider_failed', s.provider, s.model);
  }
}
