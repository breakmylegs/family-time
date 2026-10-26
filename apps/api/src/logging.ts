import type { FastifyServerOptions } from 'fastify';
import { APP_NAME } from './build.js';

/** Paths polled by Docker, update.sh and monitoring. Logged at debug, never dropped. */
export const HEALTH_PATHS = new Set(['/healthz', '/readyz', '/version']);

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined>;

/**
 * One JSON line per event: time, level, app, service, event, reqId. Secrets are redacted by
 * path, so a header or field added later with one of these names is covered without a change.
 */
export function loggerOptions(service: string, level: string, stream?: NodeJS.WritableStream): LoggerOptions {
  return {
    level,
    base: { app: APP_NAME, service },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: { level: (label: string) => ({ level: label }) },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        // `*.x` only matches one level down, so the top-level names are listed too.
        'password',
        'token',
        'secret',
        'apiKey',
        '*.password',
        '*.token',
        '*.secret',
        '*.apiKey',
      ],
      censor: '[redacted]',
    },
    ...(stream ? { stream } : {}),
  } as LoggerOptions;
}

/** Path without the query string, which may one day carry a token. */
export function logPath(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}
