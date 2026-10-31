// The six providers (brief Part 13, ADR 0016), each made from the household's sealed key. The
// model lists are a starting point the owner can add to, with prices for the spend estimate.
// Google is refused unless the owner marks its key as a paid plan (the free tier is not allowed for
// UK use); Bedrock is refused without session credentials (no long-lived access keys).
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { ProviderId } from './features.js';
import type { Usage } from './gateway.js';

/** Pence per million input and output tokens: rough, for the spend estimate and the cap. */
interface Price {
  input: number;
  output: number;
}

export interface ProviderDef {
  id: ProviderId;
  label: string;
  /** Local: data level 3 may go to it. */
  local: boolean;
  /** Models offered at first, cheapest first, with their prices. */
  models: Record<string, Price>;
  /** For a model the owner added that has no price here: assume this, to stay on the safe side. */
  unknownPrice: Price;
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  anthropic: { id: 'anthropic', label: 'Anthropic', local: false, models: { 'claude-haiku-5-5': { input: 80, output: 400 }, 'claude-sonnet-5-5': { input: 240, output: 1200 } }, unknownPrice: { input: 1200, output: 6000 } },
  openai: { id: 'openai', label: 'OpenAI', local: false, models: { 'gpt-5-mini': { input: 20, output: 160 }, 'gpt-5': { input: 100, output: 800 } }, unknownPrice: { input: 1200, output: 6000 } },
  google: { id: 'google', label: 'Google (paid plan only)', local: false, models: { 'gemini-2.5-flash': { input: 25, output: 200 }, 'gemini-2.5-pro': { input: 100, output: 800 } }, unknownPrice: { input: 1200, output: 6000 } },
  mistral: { id: 'mistral', label: 'Mistral', local: false, models: { 'mistral-small-latest': { input: 10, output: 30 }, 'mistral-large-latest': { input: 160, output: 480 } }, unknownPrice: { input: 1200, output: 6000 } },
  bedrock: { id: 'bedrock', label: 'Amazon Bedrock', local: false, models: { 'eu.anthropic.claude-haiku-5-5-v1:0': { input: 80, output: 400 } }, unknownPrice: { input: 1200, output: 6000 } },
  ollama: { id: 'ollama', label: 'Ollama (on your server)', local: true, models: { 'llama3.2': { input: 0, output: 0 }, 'qwen2.5': { input: 0, output: 0 } }, unknownPrice: { input: 0, output: 0 } },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

/** What a provider needs, opened from the household's sealed key and its plain options. */
export interface Credentials {
  key: string;
  paidTier: boolean;
  options: { region?: string; baseUrl?: string; models?: string[] };
}

export class ProviderRefused extends Error {}

/** Models the owner may choose for a provider: the starting list and any they added. */
export function modelsFor(provider: ProviderId, added: string[] = []): string[] {
  return [...new Set([...Object.keys(PROVIDERS[provider].models), ...added])];
}

/** Estimated cost in hundredths of a penny, rounded up so a run of tiny calls still counts. */
export function costCentipence(provider: ProviderId, model: string, usage: Usage): number {
  const def = PROVIDERS[provider];
  const p = def.models[model] ?? def.unknownPrice;
  return Math.ceil(((usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000) * 100);
}

/** The model to call, made fresh for each request from the household's own credentials. */
export function languageModel(provider: ProviderId, model: string, c: Credentials): LanguageModel {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: c.key })(model);
    case 'openai':
      return createOpenAI({ apiKey: c.key })(model);
    case 'google':
      // The free tier may use what it is sent for training, and is not allowed for UK users.
      if (!c.paidTier) throw new ProviderRefused('Google is only used with a key on a paid plan.');
      return createGoogleGenerativeAI({ apiKey: c.key })(model);
    case 'mistral':
      return createMistral({ apiKey: c.key })(model);
    case 'bedrock': {
      // The key is JSON: { accessKeyId, secretAccessKey, sessionToken }. No session token, no call.
      const k = JSON.parse(c.key) as { accessKeyId?: string; secretAccessKey?: string; sessionToken?: string };
      if (!k.accessKeyId || !k.secretAccessKey || !k.sessionToken) throw new ProviderRefused('Bedrock needs temporary credentials with a session token, not a long-lived access key.');
      return createAmazonBedrock({ region: c.options.region ?? 'eu-west-2', accessKeyId: k.accessKeyId, secretAccessKey: k.secretAccessKey, sessionToken: k.sessionToken })(model);
    }
    case 'ollama':
      return createOpenAICompatible({ name: 'ollama', baseURL: c.options.baseUrl ?? 'http://ollama:11434/v1' })(model);
  }
}
