// Live updates for the Control screen. Something changed for a household: the api's own routes say
// so straight away, and the worker says so through Postgres NOTIFY after each reconcile and usage
// run. The browser hears a bare "change" over Server-Sent Events and fetches the status again, so
// the stream never carries data the status route would not.
import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';

export class Changes {
  private readonly emitter = new EventEmitter();

  constructor() {
    // One listener per open Control screen; a family has a handful.
    this.emitter.setMaxListeners(200);
  }

  emit(householdId: string): void {
    this.emitter.emit('change', householdId);
  }

  subscribe(listener: (householdId: string) => void): () => void {
    this.emitter.on('change', listener);
    return () => this.emitter.off('change', listener);
  }
}

/** A comment line every so often keeps proxies and the phone from closing a quiet stream. */
const KEEPALIVE_MS = 25_000;

export async function eventRoutes(app: FastifyInstance, deps: { changes: Changes; keepaliveMs?: number }): Promise<void> {
  // Open streams never go idle, so the server ends them itself on shutdown.
  const open = new Set<{ end: () => void }>();
  app.addHook('preClose', async () => {
    for (const res of open) res.end();
  });

  app.get('/api/events', { config: { access: 'status.view' } }, async (request, reply) => {
    const householdId = request.auth!.person.householdId;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    });
    // Tells the browser to wait 5 seconds before reconnecting, and that the stream is open.
    res.write('retry: 5000\n\n');
    res.write('event: ready\ndata: {}\n\n');
    const unsubscribe = deps.changes.subscribe((id) => {
      if (id === householdId) res.write('event: change\ndata: {}\n\n');
    });
    const timer = setInterval(() => res.write(': keepalive\n\n'), deps.keepaliveMs ?? KEEPALIVE_MS);
    open.add(res);
    const done = () => {
      clearInterval(timer);
      unsubscribe();
      open.delete(res);
    };
    request.raw.once('close', done);
    res.once('close', done);
  });
}
