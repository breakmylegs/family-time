// AI and MCP (Phase 7, ADR 0016): the owner's settings, the three features' answers, and the
// apps connected over MCP. Keys go in and never come out: only their last four characters do.
import { z } from 'zod';

export const AiProviderId = z.enum(['anthropic', 'openai', 'google', 'mistral', 'bedrock', 'ollama']);
export const AiFeatureId = z.enum(['control', 'suggestions', 'summary']);

export const AiFeatureSetting = z.object({
  on: z.boolean(),
  provider: AiProviderId.nullable(),
  model: z.string().max(100).nullable(),
  monthlyCapPence: z.number().int().min(0).max(10_000),
  levelTwo: z.boolean(),
});
export type AiFeatureSetting = z.infer<typeof AiFeatureSetting>;

export const AiSettings = z.object({
  /** False without a master key: nothing can be switched on. */
  available: z.boolean(),
  on: z.boolean(),
  features: z.array(
    z.object({
      id: AiFeatureId,
      title: z.string(),
      does: z.string(),
      sends: z.string(),
      level: z.number().int(),
      proposes: z.boolean(),
      fallback: z.string(),
      setting: AiFeatureSetting,
    }),
  ),
  providers: z.array(
    z.object({
      id: AiProviderId,
      label: z.string(),
      local: z.boolean(),
      models: z.array(z.string()),
      key: z.object({ lastFour: z.string(), paidTier: z.boolean(), options: z.record(z.string(), z.unknown()) }).nullable(),
    }),
  ),
  /** Hundredths of a penny, this calendar month. */
  spentThisMonth: z.record(z.string(), z.number()),
  mcp: z.object({ on: z.boolean() }),
});
export type AiSettings = z.infer<typeof AiSettings>;

export const AiSettingsInput = z.object({
  on: z.boolean(),
  features: z.object({ control: AiFeatureSetting, suggestions: AiFeatureSetting, summary: AiFeatureSetting }).partial(),
  mcp: z.object({ on: z.boolean() }),
});

export const AiKeyInput = z.object({
  /** Empty keeps the stored key: the field is write-only. */
  key: z.string().trim().max(4000).nullable().default(null),
  paidTier: z.boolean().default(false),
  options: z
    .object({
      region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/).optional(),
      /** Ollama's address on your network, for example http://192.168.1.20:11434/v1. */
      baseUrl: z.url({ protocol: /^https?$/ }).max(200).optional(),
      models: z.array(z.string().max(100)).max(10).optional(),
    })
    .default({}),
});

/** Which AI features are ready, for the screens that offer them. */
export const AiFeatures = z.object({ control: z.boolean(), suggestions: z.boolean(), summary: z.boolean() });
export type AiFeatures = z.infer<typeof AiFeatures>;

export const AiControlRequest = z.object({ text: z.string().trim().min(3).max(280) });
export const AiControlResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), made: z.array(z.object({ id: z.uuid(), summary: z.string() })), note: z.string() }),
  z.object({ ok: z.literal(false), message: z.string(), fallback: z.string() }),
]);
export type AiControlResult = z.infer<typeof AiControlResult>;

export const JobIdeaEntry = z.object({ title: z.string(), picture: z.string(), rewardType: z.enum(['money', 'flex', 'praise']), amount: z.number().int() });
export const JobIdeas = z.object({ ideas: z.array(JobIdeaEntry), fromAi: z.boolean(), message: z.string().nullable() });
export type JobIdeas = z.infer<typeof JobIdeas>;

export const WeekNote = z.object({ text: z.string(), fromAi: z.boolean() });
export type WeekNote = z.infer<typeof WeekNote>;

export const McpClientEntry = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The address its details came from. */
  clientUri: z.string(),
  scopes: z.array(z.string()),
  allowed: z.boolean(),
  lastUsed: z.string().nullable(),
});
export type McpClientEntry = z.infer<typeof McpClientEntry>;

export const McpServerEntry = z.object({
  id: z.uuid(),
  name: z.string(),
  url: z.string(),
  approved: z.boolean(),
  tools: z.array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) })),
});
export type McpServerEntry = z.infer<typeof McpServerEntry>;

export const McpServerInput = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.url({ protocol: /^https$/ }).max(300),
  approved: z.boolean(),
  /** The tools it may call, each with the arguments to send (a place name for a forecast). */
  tools: z.array(z.object({ name: z.string().trim().min(1).max(100), arguments: z.record(z.string(), z.union([z.string().max(200), z.number()])) })).max(5),
});

/** The consent screen: who is asking, for what. */
export const OAuthConsent = z.object({
  client: z.object({ name: z.string(), uri: z.string(), host: z.string() }),
  scopes: z.array(z.enum(['read', 'propose'])),
  /** False: the owner has not allowed this app yet. The owner allows it by approving here. */
  allowed: z.boolean(),
  canAllow: z.boolean(),
});
export type OAuthConsent = z.infer<typeof OAuthConsent>;

export const OAuthAuthorizeQuery = z.object({
  response_type: z.literal('code'),
  client_id: z.url({ protocol: /^https?$/ }).max(500),
  redirect_uri: z.url().max(500),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal('S256'),
  scope: z.string().max(100).default('read'),
  state: z.string().max(500).optional(),
  resource: z.url().max(500).optional(),
});
export type OAuthAuthorizeQuery = z.infer<typeof OAuthAuthorizeQuery>;
