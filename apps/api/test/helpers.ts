import { Writable } from 'node:stream';
import { recordHeartbeat } from '@family-time/db';
import { testDb, type TestDb } from '@family-time/db/testing';
import type { FastifyInstance } from 'fastify';
import { readBuildInfo, type BuildInfo } from '../src/build.js';
import type { QueryLogEntry } from '../src/routes/control.js';
import type { ServerDeps } from '../src/server.js';
import { buildServer } from '../src/server.js';

export const NOW = new Date('2026-10-26T18:32:00Z');

/** Collects the server's log lines as parsed JSON. */
export class LogSink extends Writable {
  lines: Record<string, unknown>[] = [];
  override _write(chunk: Buffer, _enc: BufferEncoding, done: () => void) {
    for (const line of chunk.toString().split('\n')) if (line.trim()) this.lines.push(JSON.parse(line));
    done();
  }
}

export interface Harness {
  app: FastifyInstance;
  handle: TestDb;
  logs: LogSink;
  close: () => Promise<void>;
}

export async function harness(
  options: {
    migrated?: boolean;
    heartbeat?: boolean;
    build?: Partial<BuildInfo>;
    logLevel?: string;
    now?: Date;
    /** A clock the test can move. Wins over `now`. */
    clock?: () => Date;
    vapidPublicKey?: string;
    notifyChange?: () => Promise<void>;
    readQuerylog?: (limit: number, deviceId?: string) => Promise<QueryLogEntry[]>;
    aiModel?: ServerDeps['aiModel'];
    readWeather?: ServerDeps['readWeather'];
    fetchClientMetadata?: ServerDeps['fetchClientMetadata'];
    oidc?: ServerDeps['oidc'];
  } = {},
): Promise<Harness> {
  const handle = await testDb({ migrated: options.migrated ?? true });
  if (options.heartbeat ?? true) await recordHeartbeat(handle.db, 'abc123', new Date(NOW.getTime() - 10_000));
  const logs = new LogSink();
  const build = { ...readBuildInfo({ GIT_COMMIT: 'abc123', BUILD_TIME: '2026-10-26T18:00:00Z' }), ...options.build };
  const at = options.now ?? NOW;
  const app = await buildServer({
    db: handle.db,
    build,
    now: options.clock ?? (() => at),
    ...(options.vapidPublicKey ? { vapidPublicKey: options.vapidPublicKey } : {}),
    logStream: logs,
    logLevel: options.logLevel ?? 'debug',
    ...(options.notifyChange ? { notifyChange: options.notifyChange } : {}),
    ...(options.readQuerylog ? { readQuerylog: options.readQuerylog } : {}),
    ...(options.aiModel ? { aiModel: options.aiModel } : {}),
    ...(options.readWeather ? { readWeather: options.readWeather } : {}),
    ...(options.fetchClientMetadata ? { fetchClientMetadata: options.fetchClientMetadata } : {}),
    ...(options.oidc ? { oidc: options.oidc } : {}),
  });
  return {
    app,
    handle,
    logs,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}
