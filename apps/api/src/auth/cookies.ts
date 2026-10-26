// A few lines of cookie handling, rather than a plugin dependency.

/** `__Host-` cookies must be Secure, Path=/ and have no Domain, so a subdomain cannot set them. */
export const SESSION_COOKIE = '__Host-ft_session';
export const CSRF_COOKIE = '__Host-ft_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // A cookie we cannot decode is not one we set.
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  httpOnly: boolean;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'Secure', 'SameSite=Lax', `Max-Age=${options.maxAgeSeconds}`];
  if (options.httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

export function clearCookie(name: string, httpOnly: boolean): string {
  return serializeCookie(name, '', { maxAgeSeconds: 0, httpOnly });
}
