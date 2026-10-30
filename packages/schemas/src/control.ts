import { z } from 'zod';

export const ControlTarget = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('service'), id: z.uuid() }),
  z.object({ kind: z.literal('group'), id: z.uuid() }),
  z.object({ kind: z.literal('everything') }),
]);
export type ControlTarget = z.infer<typeof ControlTarget>;

export const DurationChoice = z.enum(['30m', '1h', 'until-bedtime', 'until-tomorrow']);

export const OverrideRequest = z
  .object({
    target: ControlTarget,
    type: z.enum(['allow', 'block', 'pause']),
    /** `until-resume` is for Pause only: every other override ends on its own. */
    duration: z.union([DurationChoice, z.literal('until-resume')]),
    /** "Count it in his weekly time". On unless the parent turns it off. */
    countsAgainstAllowance: z.boolean().default(true),
  })
  .refine((r) => r.duration !== 'until-resume' || r.type === 'pause', { message: 'Only Pause can last until you resume it. Pick a time for Allow or Block.' });
export type OverrideRequest = z.infer<typeof OverrideRequest>;

export const NormalRequest = z.object({ target: ControlTarget });

export const ServiceStatus = z.object({
  id: z.uuid(),
  name: z.string(),
  icon: z.string().nullable(),
  state: z.enum(['allowed', 'blocked', 'paused']),
  layer: z.enum(['pause', 'override', 'schedule', 'allowed-time', 'default']),
  /** Shown verbatim. */
  reason: z.string(),
  until: z.string().nullable(),
  /** True when every device of the child has confirmed AdGuard holds this state. */
  inForce: z.boolean(),
  /** Minutes today with real activity, from the query log. Approximate. */
  usageMinutesToday: z.number().int(),
  /** The parent's Allow or Block in force on this service, for the segmented control and Undo. */
  override: z.object({ id: z.uuid(), type: z.enum(['allow', 'block']) }).nullable(),
  /** True when a planned or approved session is running now (a Block would pause it). */
  inPlannedTime: z.boolean(),
});
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const DeviceStatus = z.object({
  id: z.uuid(),
  label: z.string(),
  type: z.string(),
  sync: z.enum(['confirmed', 'pending', 'not-confirmed', 'never']),
  confirmedAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  quietSince: z.string().nullable(),
});
export type DeviceStatus = z.infer<typeof DeviceStatus>;

export const DayBlock = z.object({
  type: z.enum(['school', 'pause', 'wind-down', 'bed', 'free']),
  label: z.string(),
  start: z.string(),
  end: z.string(),
  startLabel: z.string(),
  endLabel: z.string(),
});
export type DayBlock = z.infer<typeof DayBlock>;

export const DurationOption = z.object({
  choice: DurationChoice,
  label: z.string(),
  until: z.string(),
  end: z.string(),
  note: z.string().optional(),
  overridesBedtime: z.boolean(),
});
export type DurationOption = z.infer<typeof DurationOption>;

export const ChildStatus = z.object({
  child: z.object({ id: z.uuid(), name: z.string(), pronouns: z.enum(['he', 'she', 'they']) }),
  at: z.string(),
  /** The top of Control: "Free time now." and "Wind-down starts at 19:30." */
  headline: z.object({ lead: z.string(), rest: z.string() }),
  day: z.array(DayBlock),
  /** Pause everything, when a parent has it on. */
  pause: z.object({ id: z.uuid(), by: z.string(), until: z.string().nullable() }).nullable(),
  services: z.array(ServiceStatus),
  devices: z.array(DeviceStatus),
  /** The sheet's choices, with real end times. */
  durations: z.object({ allow: z.array(DurationOption), block: z.array(DurationOption), pause: z.array(DurationOption) }),
});
export type ChildStatus = z.infer<typeof ChildStatus>;

export const Mood = z.enum(['calm', 'grumble', 'meltdown']);
export type Mood = z.infer<typeof Mood>;

/** One line of Today history. `ending` is there when parents can tap how it went. */
export const HistoryEntry = z.object({
  at: z.string(),
  time: z.string(),
  text: z.string(),
  ending: z.object({ ref: z.string(), mood: Mood.nullable() }).optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const EndingRequest = z.object({ ref: z.string().regex(/^(start|end):[0-9a-f-]{36}$/), mood: Mood });
export type EndingRequest = z.infer<typeof EndingRequest>;

/**
 * The browsers' push services. The worker posts to a subscription's endpoint, so it must be one of
 * these and never an address someone typed (that would let the server be pointed anywhere).
 */
export const PUSH_SERVICE_HOSTS = /^([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export const PushSubscriptionRequest = z.object({
  endpoint: z.url({ protocol: /^https$/, hostname: PUSH_SERVICE_HOSTS }).max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(64) }),
});
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequest>;

export const HelpFeedbackRequest = z.object({ topicId: z.string().regex(/^[a-z0-9-]{1,64}$/), helpful: z.boolean() });
export type HelpFeedbackRequest = z.infer<typeof HelpFeedbackRequest>;

export const ChildSummary = z.object({ id: z.uuid(), name: z.string(), devices: z.number().int() });
export type ChildSummary = z.infer<typeof ChildSummary>;

export const DiscoveredDomain = z.object({ domain: z.string(), queries: z.number().int(), service: z.string().nullable() });
export type DiscoveredDomain = z.infer<typeof DiscoveredDomain>;
