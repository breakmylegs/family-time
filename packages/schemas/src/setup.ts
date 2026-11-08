// Settings editors (Phase 9): devices and their AdGuard clients, groups and each child's rule for
// them, and the schedules. The owner's, on the same commands the server's command line uses.
import { z } from 'zod';

export const DEVICE_KINDS = ['ipad', 'phone', 'console', 'laptop', 'tv', 'kiosk', 'other'] as const;
export const SCHEDULE_BLOCK_TYPES = ['school', 'pause', 'wind-down', 'bed', 'free'] as const;

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 20:30.');

export const SetupView = z.object({
  children: z.array(z.object({ id: z.uuid(), name: z.string() })),
  devices: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      type: z.string(),
      childId: z.uuid().nullable(),
      identifiers: z.array(z.string()),
      /** The same states, and words, as Control's devices. */
      sync: z.enum(['confirmed', 'pending', 'not-confirmed', 'never']),
    }),
  ),
  groups: z.array(z.object({ id: z.uuid(), name: z.string(), services: z.array(z.object({ id: z.uuid(), name: z.string() })) })),
  /** Services in no group, which only a service rule or Allow can reach. */
  ungrouped: z.array(z.object({ id: z.uuid(), name: z.string() })),
  policies: z.array(z.object({ childId: z.uuid(), groupId: z.uuid(), defaultState: z.enum(['blocked', 'allowed']), allowedDuringWindDown: z.boolean(), alwaysAllowed: z.boolean() })),
  schedules: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      childId: z.uuid().nullable(),
      weekdays: z.array(z.number().int()),
      blocks: z.array(z.object({ type: z.enum(SCHEDULE_BLOCK_TYPES), start: z.string(), end: z.string(), label: z.string().optional() })),
    }),
  ),
});
export type SetupView = z.infer<typeof SetupView>;

export const DeviceRequest = z.object({
  label: z.string().trim().min(1, 'Give the device a name.').max(40),
  type: z.enum(DEVICE_KINDS),
  childId: z.uuid(),
  identifiers: z.array(z.string().trim().min(1).max(64, 'That address is too long. Check it against your router.')).min(1, 'Give at least one address, like 192.168.1.50.').max(8, 'A device can have up to 8 addresses.'),
});

export const PolicyRequest = z.object({
  childId: z.uuid(),
  groupId: z.uuid(),
  defaultState: z.enum(['blocked', 'allowed']),
  allowedDuringWindDown: z.boolean(),
  alwaysAllowed: z.boolean(),
});

export const ServiceGroupRequest = z.object({ groupId: z.uuid().nullable() });

export const ScheduleBlockInput = z.object({ type: z.enum(SCHEDULE_BLOCK_TYPES), start: Clock, end: Clock, label: z.string().trim().max(20).optional() });
export const ScheduleRequest = z.object({
  name: z.string().trim().min(1, 'Give the schedule a name.').max(40),
  childId: z.uuid().nullable(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one day.').max(7),
  blocks: z.array(ScheduleBlockInput).min(1, 'Add at least one part of the day.').max(12),
});
