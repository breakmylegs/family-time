import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves the parent app's build (ADR 0003). Files under assets/ have hashed names and are cached
 * for a year; everything else, index.html above all, is revalidated every time. Any other path
 * that is not under /api gets index.html, so the app's own routes work on reload.
 */
export function registerStatic(app: FastifyInstance, dir: string): void {
  const root = resolve(dir);
  const indexFile = join(root, 'index.html');
  if (!existsSync(indexFile)) throw new Error(`No parent app build at ${root}. Run the build first.`);

  app.get('/*', { config: { access: 'public' } }, async (request, reply) => {
    const path = decodeURIComponent((request.params as { '*': string })['*'] ?? '');
    if (path === 'api' || path.startsWith('api/')) return reply.code(404).send({ error: 'not_found' });
    const file = normalize(join(root, path));
    const inside = file === root || file.startsWith(root + sep);
    const target = inside && existsSync(file) && statSync(file).isFile() ? file : indexFile;
    const immutable = target !== indexFile && path.startsWith('assets/');
    return reply
      .header('content-type', TYPES[extname(target)] ?? 'application/octet-stream')
      .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(readFileSync(target));
  });
}
