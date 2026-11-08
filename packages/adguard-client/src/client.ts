// A typed client for the AdGuard Home v0.107.79 calls we use. Written by hand and checked against
// the vendored spec (spec/openapi-v0.107.79.json) by test/spec.test.ts: a path, method or field
// that is not in the spec fails the build. Only the control service may use this (ADR 0010).

/** Every call this client makes, for the spec test. Body fields are top-level property names. */
export const CALLS = [
  { method: 'get', path: '/status' },
  { method: 'get', path: '/clients' },
  { method: 'post', path: '/clients/add', schema: 'Client' },
  { method: 'post', path: '/clients/update', schema: 'ClientUpdate' },
  { method: 'post', path: '/clients/delete', schema: 'ClientDelete' },
  { method: 'get', path: '/blocked_services/all' },
  { method: 'get', path: '/filtering/status' },
  { method: 'post', path: '/filtering/set_rules', schema: 'SetRulesRequest' },
  { method: 'post', path: '/filtering/add_url', schema: 'AddUrlRequest' },
  { method: 'get', path: '/querylog' },
  { method: 'post', path: '/dns_config', schema: 'DNSConfig' },
  { method: 'get', path: '/dns_info' },
  { method: 'get', path: '/querylog/config' },
  { method: 'put', path: '/querylog/config/update', schema: 'GetQueryLogConfigResponse' },
  { method: 'get', path: '/stats/config' },
  { method: 'put', path: '/stats/config/update', schema: 'GetStatsConfigResponse' },
  { method: 'get', path: '/install/get_addresses' },
  { method: 'post', path: '/install/configure', schema: 'InitialConfiguration' },
] as const;

export interface Schedule {
  time_zone?: string;
  mon?: { start: number; end: number };
  tue?: { start: number; end: number };
  wed?: { start: number; end: number };
  thu?: { start: number; end: number };
  fri?: { start: number; end: number };
  sat?: { start: number; end: number };
  sun?: { start: number; end: number };
}

/** A persistent client. We set only the fields we own and pass the rest back untouched. */
export interface AdGuardClientRecord {
  name: string;
  ids: string[];
  use_global_settings?: boolean;
  filtering_enabled?: boolean;
  parental_enabled?: boolean;
  safebrowsing_enabled?: boolean;
  safesearch_enabled?: boolean;
  use_global_blocked_services?: boolean;
  blocked_services?: string[];
  blocked_services_schedule?: Schedule;
  upstreams?: string[];
  tags?: string[];
  ignore_querylog?: boolean;
  ignore_statistics?: boolean;
  [other: string]: unknown;
}

export interface BlockedService {
  id: string;
  name: string;
  rules: string[];
  group_id?: string;
}

export interface QueryLogItem {
  time: string;
  client: string;
  client_id?: string;
  client_info?: { name: string };
  question: { name: string; type: string };
  reason?: string;
}

export interface QueryLog {
  data: QueryLogItem[];
  oldest: string;
}

export class AdGuardError extends Error {
  constructor(
    readonly status: number,
    readonly call: string,
    readonly body: string,
  ) {
    super(`AdGuard ${call} answered ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
}

export interface AdGuardOptions {
  /** For example `http://adguard:3000`. The admin API is on the internal network only. */
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class AdGuard {
  private readonly auth: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: AdGuardOptions) {
    this.auth = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`;
    this.doFetch = options.fetchImpl ?? fetch;
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const url = new URL(`/control${path}`, this.options.baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await this.doFetch(url, {
      method,
      headers: { authorization: this.auth, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
    });
    const text = await res.text();
    if (!res.ok) throw new AdGuardError(res.status, `${method} ${path}`, text);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some write calls answer "OK" as plain text.
      return text as T;
    }
  }

  status() {
    return this.call<{ version: string; running: boolean; protection_enabled: boolean }>('GET', '/status');
  }

  async listClients(): Promise<AdGuardClientRecord[]> {
    const r = await this.call<{ clients: AdGuardClientRecord[] | null }>('GET', '/clients');
    return r.clients ?? [];
  }

  async findClient(name: string): Promise<AdGuardClientRecord | undefined> {
    return (await this.listClients()).find((c) => c.name === name);
  }

  addClient(client: AdGuardClientRecord) {
    return this.call<void>('POST', '/clients/add', client);
  }

  /** Only ever for one of our own `ft-` clients, when its device is removed in Settings. */
  deleteClient(name: string) {
    return this.call<void>('POST', '/clients/delete', { name });
  }

  /** AdGuard replaces the whole client with `data`, so always send the full object. */
  updateClient(name: string, data: AdGuardClientRecord) {
    return this.call<void>('POST', '/clients/update', { name, data });
  }

  async blockedServices(): Promise<BlockedService[]> {
    return (await this.call<{ blocked_services: BlockedService[] }>('GET', '/blocked_services/all')).blocked_services;
  }

  async userRules(): Promise<string[]> {
    return (await this.call<{ user_rules: string[] | null }>('GET', '/filtering/status')).user_rules ?? [];
  }

  /** Replaces every user rule. Use rules.ts to change only our managed block. */
  setRules(rules: string[]) {
    return this.call<void>('POST', '/filtering/set_rules', { rules });
  }

  addFilterUrl(name: string, url: string) {
    return this.call<void>('POST', '/filtering/add_url', { name, url, whitelist: false });
  }

  async filterUrls(): Promise<string[]> {
    const r = await this.call<{ filters: { url: string }[] | null }>('GET', '/filtering/status');
    return (r.filters ?? []).map((f) => f.url);
  }

  /** Newest first. `olderThan` pages backwards. */
  querylog(options: { limit: number; olderThan?: string }) {
    return this.call<QueryLog>('GET', '/querylog', undefined, {
      limit: String(options.limit),
      ...(options.olderThan ? { older_than: options.olderThan } : {}),
    });
  }

  dnsInfo() {
    return this.call<Record<string, unknown>>('GET', '/dns_info');
  }

  setDnsConfig(config: Record<string, unknown>) {
    return this.call<void>('POST', '/dns_config', config);
  }

  querylogConfig() {
    return this.call<{ enabled: boolean; interval: number; anonymize_client_ip: boolean; ignored: string[] }>('GET', '/querylog/config');
  }

  setQuerylogConfig(config: { enabled: boolean; interval: number; anonymize_client_ip: boolean; ignored: string[] }) {
    return this.call<void>('PUT', '/querylog/config/update', config);
  }

  statsConfig() {
    return this.call<{ enabled: boolean; interval: number; ignored: string[] }>('GET', '/stats/config');
  }

  setStatsConfig(config: { enabled: boolean; interval: number; ignored: string[] }) {
    return this.call<void>('PUT', '/stats/config/update', config);
  }

  /** Before first-time setup, AdGuard answers this without credentials and refuses everything else. */
  installAddresses() {
    return this.call<{ web_port: number; dns_port: number }>('GET', '/install/get_addresses');
  }

  configure(config: { web: { ip: string; port: number }; dns: { ip: string; port: number }; username: string; password: string }) {
    return this.call<void>('POST', '/install/configure', config);
  }
}
