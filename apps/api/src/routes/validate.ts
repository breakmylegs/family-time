import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

/** Parses the body with a Zod schema. On failure, sends a 400 whose detail a person can act on. */
export function parseBody<S extends z.ZodType>(schema: S, request: FastifyRequest, reply: FastifyReply): z.infer<S> | undefined {
  const result = schema.safeParse(request.body ?? {});
  if (result.success) return result.data;
  const first = result.error.issues[0];
  void reply.code(400).send({ error: 'invalid_request', detail: first?.message ?? 'Something in the request was not right.' });
  return undefined;
}
