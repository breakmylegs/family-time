// The parent app's side of the kiosk (ADR 0015): set one up with a pairing code, see the kiosks
// the family has, remove one (which stops it at once), and the photo from "I did it".
import { people, type Db } from '@family-time/db';
import { KioskPairingRequest, KioskPinRequest, type KioskPairing, type KioskPinChild } from '@family-time/schemas';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { createPairing, listKiosks, photoFor, removeKiosk } from '../kiosk/commands.js';
import { setKioskPin } from '../kiosk/pin.js';
import { parseBody } from './validate.js';

export interface KioskRouteDeps {
  db: Db;
  now: () => Date;
  /** Where the kiosk lives on the LAN, shown with the code: `http://192.168.1.10:8180`. */
  kioskUrl?: string;
}

const Id = z.object({ id: z.uuid() });

export async function kioskRoutes(app: FastifyInstance, deps: KioskRouteDeps): Promise<void> {
  const { db, now } = deps;

  app.get('/api/kiosks', { config: { access: 'system.manage' } }, async (request) => listKiosks(db, request.auth!.person.householdId));

  // Kiosk PINs, for siblings sharing a tablet: whether each child has one, never the PIN itself.
  app.get('/api/kiosks/pins', { config: { access: 'system.manage' } }, async (request): Promise<KioskPinChild[]> => {
    const rows = await db
      .select({ id: people.id, name: people.displayName, pin: people.kioskPinHash })
      .from(people)
      .where(and(eq(people.householdId, request.auth!.person.householdId), eq(people.role, 'child'), eq(people.active, true)))
      .orderBy(asc(people.displayName));
    return rows.map((r) => ({ id: r.id, name: r.name, pin: r.pin !== null }));
  });

  app.put<{ Params: { id: string } }>('/api/kiosks/pins/:id', { config: { access: 'system.manage', rateLimit: { max: 20, windowMs: 10 * 60_000 } } }, async (request, reply) => {
    const id = Id.safeParse(request.params);
    if (!id.success) return reply.code(404).send({ error: 'not_found' });
    const body = parseBody(KioskPinRequest, request, reply);
    if (!body) return reply;
    const me = request.auth!.person;
    const ok = await setKioskPin(db, { householdId: me.householdId, childId: id.data.id, by: me.id, pin: body.pin, ip: request.ip });
    if (!ok) return reply.code(404).send({ error: 'not_found', detail: "Family time can't find that child. Reload to see who's in your family now." });
    return { ok: true, pin: body.pin !== null };
  });

  app.post('/api/kiosks/pairing', { config: { access: 'system.manage', rateLimit: { max: 10, windowMs: 10 * 60_000 } } }, async (request, reply) => {
    const body = parseBody(KioskPairingRequest, request, reply);
    if (!body) return reply;
    const person = request.auth!.person;
    const { code, expiresAt } = await createPairing(db, { householdId: person.householdId, by: person.id, label: body.label }, now());
    await audit(db, { householdId: person.householdId, actor: { personId: person.id }, action: 'kiosk.pairing', targetType: 'kiosk', after: { label: body.label } });
    const out: KioskPairing = {
      code,
      expires: expiresAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }),
      label: body.label,
      kioskUrl: deps.kioskUrl ?? null,
    };
    return reply.code(201).send(out);
  });

  app.delete<{ Params: { id: string } }>('/api/kiosks/:id', { config: { access: 'system.manage' } }, async (request, reply) => {
    const parsed = Id.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    const { id } = parsed.data;
    const person = request.auth!.person;
    if (!(await removeKiosk(db, person.householdId, id, now()))) return reply.code(404).send({ error: 'not_found' });
    await audit(db, { householdId: person.householdId, actor: { personId: person.id }, action: 'kiosk.removed', targetType: 'kiosk', targetId: id });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/completions/:id/photo', { config: { access: 'approvals.decide' } }, async (request, reply) => {
    const parsed = Id.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid' });
    const jpeg = await photoFor(db, request.auth!.person.householdId, parsed.data.id);
    if (!jpeg) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', 'image/jpeg')
      .header('cache-control', 'private, max-age=3600')
      // Shown as an image only, whatever else the bytes might hold.
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(Buffer.from(jpeg));
  });
}
