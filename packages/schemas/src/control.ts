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

export const ChildStatus = z.object({
  child: z.object({ id: z.uuid(), name: z.string() }),
  at: z.string(),
  services: z.array(ServiceStatus),
  devices: z.array(DeviceStatus),
});
export type ChildStatus = z.infer<typeof ChildStatus>;

export const ChildSummary = z.object({ id: z.uuid(), name: z.string(), devices: z.number().int() });
export type ChildSummary = z.infer<typeof ChildSummary>;

export const DiscoveredDomain = z.object({ domain: z.string(), queries: z.number().int(), service: z.string().nullable() });
export type DiscoveredDomain = z.infer<typeof DiscoveredDomain>;
