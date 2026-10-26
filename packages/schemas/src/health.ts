import { z } from 'zod';

export const Liveness = z.object({ status: z.literal('ok') });
export type Liveness = z.infer<typeof Liveness>;

export const CheckResult = z.object({
  name: z.string(),
  ok: z.boolean(),
  /** What went wrong, in words an operator can act on. Absent when ok. */
  detail: z.string().optional(),
  ms: z.number().int().nonnegative(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const Readiness = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.array(CheckResult),
});
export type Readiness = z.infer<typeof Readiness>;

export const Version = z.object({
  app: z.string(),
  commit: z.string(),
  builtAt: z.string(),
  /** Tag of the newest migration this image ships. */
  schema: z.string(),
});
export type Version = z.infer<typeof Version>;
