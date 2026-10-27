import { describe, expect, it } from 'vitest';
import { ApiFailure, csrfToken, makeApi } from '../src/api';

function fakeFetch(status: number, body: string, statusText = '') {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status, statusText });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('api client', () => {
  it('reads the CSRF cookie among others', () => {
    expect(csrfToken('a=1; __Host-ft_csrf=abc%2Fdef; b=2')).toBe('abc/def');
    expect(csrfToken('a=1')).toBeUndefined();
  });

  it('sends the CSRF token on every change, bodyless ones too, and never on GET', async () => {
    const f = fakeFetch(200, '{"ok":true}');
    const api = makeApi({ fetchImpl: f.impl, cookies: () => '__Host-ft_csrf=tok' });
    await api('POST', '/api/auth/logout');
    await api('GET', '/api/me');
    expect((f.calls[0]!.init.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
    expect(f.calls[0]!.init.body).toBeUndefined();
    expect((f.calls[1]!.init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('shows the server sentence when there is one', async () => {
    const f = fakeFetch(409, '{"error":"last_owner","detail":"This is the only owner."}');
    const api = makeApi({ fetchImpl: f.impl, cookies: () => '' });
    await expect(api('DELETE', '/api/people/x')).rejects.toMatchObject({ status: 409, code: 'last_owner', message: 'This is the only owner.' });
  });

  it('shows the HTTP status when the reply is not JSON', async () => {
    const f = fakeFetch(502, '<html>Bad gateway</html>', 'Bad Gateway');
    const api = makeApi({ fetchImpl: f.impl, cookies: () => '' });
    const err = await api('GET', '/api/me').catch((e: ApiFailure) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).message).toMatch(/502 Bad Gateway/);
  });

  it('says so when a 200 is not JSON', async () => {
    const f = fakeFetch(200, '<html>login page</html>');
    const api = makeApi({ fetchImpl: f.impl, cookies: () => '' });
    await expect(api('GET', '/api/me')).rejects.toMatchObject({ code: 'not_json' });
  });

  it('says what to do when the network is down', async () => {
    const api = makeApi({ fetchImpl: (async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch, cookies: () => '' });
    await expect(api('GET', '/api/me')).rejects.toMatchObject({ code: 'offline' });
  });
});
