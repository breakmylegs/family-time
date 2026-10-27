// Every call to the api goes through here: JSON in and out, the CSRF token on every change, and
// an error a person can read, with the HTTP status when the server did not answer in JSON.

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const CSRF_COOKIE = '__Host-ft_csrf';

export function csrfToken(cookies: string): string | undefined {
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export interface ApiOptions {
  fetchImpl?: typeof fetch;
  cookies?: () => string;
}

export function makeApi(options: ApiOptions = {}) {
  const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const cookies = options.cookies ?? (() => document.cookie);

  return async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') {
      const token = csrfToken(cookies());
      if (token) headers['x-csrf-token'] = token;
    }
    let res: Response;
    try {
      res = await doFetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiFailure(0, 'offline', 'Could not reach Family time. Check you are on the internet, then try again.');
    }
    // Read the body once, as text, then decide what it is.
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      const d = (data ?? {}) as { error?: string; detail?: string };
      throw new ApiFailure(res.status, d.error ?? `http_${res.status}`, d.detail ?? `The server answered ${res.status} ${res.statusText}. Try again in a moment.`);
    }
    if (text && data === undefined) {
      throw new ApiFailure(res.status, 'not_json', `The server answered ${res.status}, but not in a form the app understands. Reload the page.`);
    }
    return data as T;
  };
}

export const api = makeApi();
