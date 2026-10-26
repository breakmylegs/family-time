import { afterEach, describe, expect, it } from 'vitest';
import { harness, type Harness } from './helpers.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('logging', () => {
  it('writes one JSON line per request with the agreed fields', async () => {
    h = await harness();
    await h.app.inject('/nowhere?token=abc');
    const line = h.logs.lines.find((l) => l.event === 'request');
    expect(line).toMatchObject({ level: 'info', app: 'family-time', service: 'api', method: 'GET', path: '/nowhere', status: 404 });
    expect(typeof line?.time).toBe('string');
    expect(typeof line?.reqId).toBe('string');
    expect(JSON.stringify(h.logs.lines)).not.toContain('token=abc');
  });

  it('logs health probes at debug, so they vanish at info but are not dropped', async () => {
    h = await harness();
    await h.app.inject('/healthz');
    const line = h.logs.lines.find((l) => l.event === 'request' && l.path === '/healthz');
    expect(line?.level).toBe('debug');
  });

  it('keeps health probes out of the log at the info level', async () => {
    h = await harness({ logLevel: 'info' });
    await h.app.inject('/healthz');
    await h.app.inject('/nowhere');
    const paths = h.logs.lines.filter((l) => l.event === 'request').map((l) => l.path);
    expect(paths).toEqual(['/nowhere']);
  });

  it('redacts cookies and authorisation headers', async () => {
    h = await harness();
    h.app.log.info({ event: 'probe', req: { headers: { cookie: 'sid=secret', authorization: 'Bearer secret' } } });
    h.app.log.info({ event: 'probe', password: 'hunter2', nested: { token: 'tok-secret' } });
    const text = JSON.stringify(h.logs.lines);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('hunter2');
    expect(h.logs.lines.find((l) => 'password' in l)?.password).toBe('[redacted]');
  });
});

describe('request handling', () => {
  it('refuses non-JSON bodies with 415 before any route runs', async () => {
    h = await harness();
    let reached = false;
    h.app.post('/probe', async () => {
      reached = true;
      return { ok: true };
    });
    const res = await h.app.inject({ method: 'POST', url: '/probe', headers: { 'content-type': 'text/plain' }, payload: 'x' });
    expect(res.statusCode).toBe(415);
    expect(reached).toBe(false);
    const form = await h.app.inject({
      method: 'POST',
      url: '/probe',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'a=b',
    });
    expect(form.statusCode).toBe(415);
  });

  it('takes the client address from one proxy hop, not from whatever the client wrote', async () => {
    h = await harness();
    h.app.get('/ip', async (request) => ({ ip: request.ip }));
    const res = await h.app.inject({
      url: '/ip',
      remoteAddress: '172.18.0.2', // Caddy
      headers: { 'x-forwarded-for': '6.6.6.6, 192.168.1.20' },
    });
    expect(res.json()).toEqual({ ip: '192.168.1.20' });
  });

  it('sets the baseline security headers', async () => {
    h = await harness();
    const res = await h.app.inject('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('answers an unknown path with a JSON 404', async () => {
    h = await harness();
    const res = await h.app.inject('/nowhere');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('hides the cause of a 500 from the caller and logs it', async () => {
    h = await harness();
    h.app.get('/boom', async () => {
      throw new Error('database password is hunter2');
    });
    const res = await h.app.inject('/boom');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal' });
    expect(h.logs.lines.some((l) => l.event === 'unhandled_error')).toBe(true);
  });
});
