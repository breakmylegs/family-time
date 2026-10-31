// The kiosk's link to the server: its token (from pairing) and the child it is showing are kept
// in the WebView's storage, so a reload or a screen-on comes straight back to the right home.
const TOKEN = 'ft-kiosk-token';
const CHILD = 'ft-kiosk-child';

export const stored = {
  token: (): string | null => localStorage.getItem(TOKEN),
  setToken: (t: string | null) => (t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN)),
  child: (): string | null => localStorage.getItem(CHILD),
  setChild: (c: string | null) => (c ? localStorage.setItem(CHILD, c) : localStorage.removeItem(CHILD)),
};

/** A refusal from the server, with words the child can read. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = stored.token();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? null : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Can't connect right now. Check the tablet is on the home Wi-Fi, or ask a grown-up.");
  }
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) {
    // Removed in Settings, or the server forgot it: back to pairing.
    if (res.status === 401) stored.setToken(null);
    throw new ApiError(res.status, data.message ?? 'That did not work. Try again.');
  }
  return data as T;
}
