// The discovery helper's other half (ADR 0022): the api holds no AdGuard password, so it asks the
// worker, the one service that talks to AdGuard, for one device's DNS questions in the last 30
// minutes. Only those questions go back, and only the time, client and domain of each; the api
// deletes the answer as soon as it has read it.
import { AdGuardError, type AdGuard } from '@family-time/adguard-client';
import { devices, discoveryRequests, type Db } from '@family-time/db';
import { eq } from 'drizzle-orm';

export const DISCOVER_QUEUE = 'discover';
const WINDOW_MS = 30 * 60_000;

/** Any HTTP answer, including "sign in first" before adguard-setup, means AdGuard is there. */
export async function adguardAnswered(adguard: AdGuard): Promise<boolean> {
  return adguard.status().then(
    () => true,
    (err: unknown) => err instanceof AdGuardError,
  );
}

export async function answerDiscovery(db: Db, adguard: AdGuard | undefined, id: string, now: Date): Promise<void> {
  const [req] = await db
    .select({ id: discoveryRequests.id, requestedAt: discoveryRequests.requestedAt, name: devices.adguardName, ids: devices.identifiers })
    .from(discoveryRequests)
    .innerJoin(devices, eq(devices.id, discoveryRequests.deviceId))
    .where(eq(discoveryRequests.id, id));
  if (!req) return;
  const finish = (values: { result?: unknown; error?: string }) => db.update(discoveryRequests).set({ ...values, finishedAt: now }).where(eq(discoveryRequests.id, req.id));
  if (!adguard) return void (await finish({ error: 'AdGuard is not set up yet. Run ./scripts/ft.sh adguard-setup on the server.' }));
  try {
    const since = req.requestedAt.getTime() - WINDOW_MS;
    const entries = (await adguard.querylog({ limit: 1000 })).data
      .filter((e) => new Date(e.time).getTime() >= since && (e.client_info?.name === req.name || req.ids.includes(e.client)))
      .map((e) => ({ time: e.time, client: e.client, client_info: e.client_info?.name ? { name: e.client_info.name } : undefined, question: { name: e.question.name, type: e.question.type } }));
    await finish({ result: entries });
  } catch (err) {
    await finish({ error: `AdGuard could not be read: ${(err as Error).message}`.slice(0, 300) });
  }
}
