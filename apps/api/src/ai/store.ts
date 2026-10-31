// The household's AI set-up (ADR 0016): the owner's switches and sealed keys, the gateway's
// dependencies, and running a feature with its fallback. With no master key there is no AI at all.
import {
  FEATURES,
  FEATURE_IDS,
  PROVIDER_IDS,
  costCentipence,
  invoke,
  languageModel,
  lastFour,
  masterKeyFrom,
  modelsFor,
  open,
  seal,
  type FeatureId,
  type FeatureSetting,
  type GatewayDeps,
  type Invoked,
  type LanguageModel,
  type ProviderId,
  type Usage,
} from '@family-time/ai';
import { aiCalls, aiKeys, aiSettings, readSecret, type Db } from '@family-time/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getSetting, setSetting } from '../settings.js';

const SETTING_MCP = 'mcp';

/** The master key, or null: AI stays off without it (fails closed). */
export function masterKey(): Buffer | null {
  try {
    return masterKeyFrom(readSecret('MASTER_KEY'));
  } catch {
    return null;
  }
}

export interface AiView {
  available: boolean;
  on: boolean;
  features: { id: FeatureId; title: string; does: string; sends: string; level: number; proposes: boolean; fallback: string; setting: FeatureSetting }[];
  providers: { id: ProviderId; label: string; local: boolean; models: string[]; key: { lastFour: string; paidTier: boolean; options: Record<string, unknown> } | null }[];
  spentThisMonth: Record<FeatureId, number>;
  mcp: { on: boolean };
}

const defaults = (id: FeatureId): FeatureSetting => ({ on: false, provider: null, model: null, monthlyCapPence: FEATURES[id].monthlyCapPence, levelTwo: false });

async function settingsRow(db: Db, householdId: string) {
  return (await db.select().from(aiSettings).where(eq(aiSettings.householdId, householdId)))[0] ?? null;
}

function startOfMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function spent(db: Db, householdId: string, feature: FeatureId, now: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${aiCalls.costCentipence}), 0)::int` })
    .from(aiCalls)
    .where(and(eq(aiCalls.householdId, householdId), eq(aiCalls.feature, feature), gte(aiCalls.at, startOfMonth(now))));
  return Number(row?.total ?? 0);
}

/** What Settings shows: never a key, only its last four. */
export async function aiView(db: Db, householdId: string, now: Date): Promise<AiView> {
  const s = await settingsRow(db, householdId);
  const stored = (s?.features ?? {}) as Partial<Record<FeatureId, FeatureSetting>>;
  const keys = await db.select().from(aiKeys).where(eq(aiKeys.householdId, householdId));
  const spentThisMonth = Object.fromEntries(await Promise.all(FEATURE_IDS.map(async (f) => [f, await spent(db, householdId, f, now)]))) as Record<FeatureId, number>;
  return {
    available: masterKey() !== null,
    on: Boolean(s?.on),
    features: FEATURE_IDS.map((id) => ({ ...FEATURES[id], setting: { ...defaults(id), ...(stored[id] ?? {}) } })),
    providers: PROVIDER_IDS.map((id) => {
      const k = keys.find((x) => x.provider === id);
      const options = (k?.options ?? {}) as { models?: string[] };
      return { id, label: providerLabel(id), local: id === 'ollama', models: modelsFor(id, options.models ?? []), key: k ? { lastFour: k.lastFour, paidTier: k.paidTier, options: k.options as Record<string, unknown> } : null };
    }),
    spentThisMonth,
    mcp: { on: Boolean((await getSetting<{ on: boolean }>(db, householdId, SETTING_MCP))?.on) },
  };
}

/** The MCP server answers only when the owner has switched it on and there is a master key. */
export async function mcpOn(db: Db, householdId: string): Promise<boolean> {
  return masterKey() !== null && Boolean((await getSetting<{ on: boolean }>(db, householdId, SETTING_MCP))?.on);
}

const providerLabel = (id: ProviderId) =>
  ({ anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google (paid plan only)', mistral: 'Mistral', bedrock: 'Amazon Bedrock', ollama: 'Ollama (on your server)' })[id];

export async function saveSettings(db: Db, householdId: string, input: { on: boolean; features: Partial<Record<FeatureId, FeatureSetting | undefined>>; mcp: { on: boolean } }, now: Date) {
  await setSetting(db, householdId, SETTING_MCP, input.mcp);
  await db
    .insert(aiSettings)
    .values({ householdId, on: input.on, features: input.features, updatedAt: now })
    .onConflictDoUpdate({ target: aiSettings.householdId, set: { on: input.on, features: input.features, updatedAt: now } });
}

/** Stores a key sealed. An empty key leaves the stored one as it is (write-only in the UI). */
export async function saveKey(db: Db, householdId: string, provider: ProviderId, input: { key: string | null; paidTier: boolean; options: Record<string, unknown> }, now: Date) {
  const mk = masterKey();
  if (!mk) throw new Error("AI isn't set up on this server yet. Run ./scripts/init.sh, then ./scripts/update.sh.");
  const existing = (await db.select().from(aiKeys).where(and(eq(aiKeys.householdId, householdId), eq(aiKeys.provider, provider))))[0];
  // Ollama needs no key; a placeholder is sealed so the provider counts as set up.
  const key = input.key?.trim() || (provider === 'ollama' && !existing ? 'local' : null);
  if (!key && !existing) throw new Error('Paste the key first.');
  const sealed = key ? seal(mk, key, `${householdId}:${provider}`) : existing!.sealed;
  const four = key ? (provider === 'ollama' ? 'none' : lastFour(key)) : existing!.lastFour;
  await db
    .insert(aiKeys)
    .values({ householdId, provider, sealed, lastFour: four, paidTier: input.paidTier, options: input.options, updatedAt: now })
    .onConflictDoUpdate({ target: [aiKeys.householdId, aiKeys.provider], set: { sealed, lastFour: four, paidTier: input.paidTier, options: input.options, updatedAt: now } });
}

export async function removeKey(db: Db, householdId: string, provider: ProviderId) {
  await db.delete(aiKeys).where(and(eq(aiKeys.householdId, householdId), eq(aiKeys.provider, provider)));
}

/** The gateway's view of this household: switches, allowed models, spend and the audit. */
export function gatewayDeps(db: Db, householdId: string, now: () => Date): GatewayDeps {
  return {
    config: async () => {
      const v = await aiView(db, householdId, now());
      return {
        // No master key: everything off, whatever the switches say.
        on: v.available && v.on,
        features: Object.fromEntries(v.features.map((f) => [f.id, f.setting])),
        allowedModels: (p) => (v.providers.find((x) => x.id === p)?.key ? v.providers.find((x) => x.id === p)!.models : []),
      };
    },
    spent: (feature) => spent(db, householdId, feature, now()),
    record: async (r) => {
      await db.insert(aiCalls).values({
        householdId,
        feature: r.feature,
        provider: r.provider,
        model: r.model,
        outcome: r.outcome,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costCentipence: r.costCentipence,
        level: r.level,
        at: now(),
      });
    },
    cost: costCentipence,
  };
}

/** Opens the household's key and makes the model, only inside a call the gateway allowed. */
export async function modelFor(db: Db, householdId: string, provider: ProviderId, model: string): Promise<LanguageModel> {
  const mk = masterKey();
  if (!mk) throw new Error('No master key');
  const k = (await db.select().from(aiKeys).where(and(eq(aiKeys.householdId, householdId), eq(aiKeys.provider, provider))))[0];
  if (!k) throw new Error('No key for that provider');
  return languageModel(provider, model, { key: open(mk, k.sealed, `${householdId}:${provider}`), paidTier: k.paidTier, options: k.options as Record<string, never> });
}

/**
 * Runs a feature through the gateway. Tests pass `model` to use a mock instead of a provider.
 */
export async function runFeature<T>(
  db: Db,
  householdId: string,
  feature: FeatureId,
  now: () => Date,
  work: (model: LanguageModel) => Promise<{ value: T; usage: Usage }>,
  model?: (provider: ProviderId, name: string) => Promise<LanguageModel>,
): Promise<Invoked<T>> {
  return invoke(gatewayDeps(db, householdId, now), feature, async (provider, name) => work(await (model ?? ((p, n) => modelFor(db, householdId, p, n)))(provider, name)));
}
