// A fake AdGuard Home for tests on the laptop, which cannot run the real container. It copies the
// behaviours we depend on: Basic auth, the first-install wizard, clients/update replacing the whole
// client, set_rules replacing every rule, the query log newest first. The same contract tests run
// against it here and against the real v0.107.79 on the server, so if it drifts from the real
// thing the server run says so.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AdGuardClientRecord, BlockedService, QueryLogItem } from './client.js';

export interface FakeFaults {
  /** The next N client updates answer 500. */
  failUpdates?: number;
  /** Client updates answer 200 but are not stored, so read-back does not match. */
  dropUpdates?: boolean;
}

export const FAKE_SERVICES: BlockedService[] = [
  { id: 'youtube', name: 'YouTube', rules: ['||youtube.com^', '||youtu.be^', '||googlevideo.com^', '||ytimg.com^'], group_id: 'video' },
  { id: 'roblox', name: 'Roblox', rules: ['||roblox.com^', '||rbxcdn.com^', '||rbxinfra.com^', '||robloxlabs.com^'], group_id: 'gaming' },
  { id: 'tiktok', name: 'TikTok', rules: ['||tiktok.com^', '||tiktokcdn.com^'], group_id: 'social_network' },
];

export class FakeAdGuard {
  configured: boolean;
  username = 'admin';
  password = 'secret';
  clients: AdGuardClientRecord[] = [];
  userRules: string[] = [];
  filters: { name: string; url: string }[] = [];
  querylog: QueryLogItem[] = [];
  dnsConfig: Record<string, unknown> = { blocked_response_ttl: 3600, cache_ttl_max: 0 };
  querylogConfig = { enabled: true, interval: 90 * 86_400_000, anonymize_client_ip: false, ignored: [] as string[] };
  statsConfig = { enabled: true, interval: 86_400_000, ignored: [] as string[] };
  faults: FakeFaults = {};
  /** Every write, for tests that check nothing else was touched. */
  writes: string[] = [];
  private server?: Server;

  constructor(options: { configured?: boolean } = {}) {
    this.configured = options.configured ?? true;
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://fake');
    const path = url.pathname.replace(/^\/control/, '');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    const send = (status: number, data?: unknown) => {
      res.writeHead(status, { 'content-type': typeof data === 'string' ? 'text/plain' : 'application/json' });
      res.end(data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data));
    };

    if (!this.configured) {
      if (path === '/install/get_addresses' && req.method === 'GET') return send(200, { web_port: 3000, dns_port: 53, interfaces: {} });
      if (path === '/install/configure' && req.method === 'POST') {
        this.username = body.username;
        this.password = body.password;
        this.configured = true;
        return send(200);
      }
      // Real AdGuard redirects every other call to the wizard until it is configured.
      return send(302);
    }

    const expected = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
    if (req.headers.authorization !== expected) return send(403, 'Forbidden');

    const route = `${req.method} ${path}`;
    switch (route) {
      case 'GET /status':
        return send(200, { version: 'v0.107.79', running: true, protection_enabled: true });
      case 'GET /clients':
        return send(200, { clients: this.clients.length ? structuredClone(this.clients) : null, auto_clients: [], supported_tags: [] });
      case 'POST /clients/add': {
        if (this.clients.some((c) => c.name === body.name)) return send(400, `client with name "${body.name}" already exists`);
        this.writes.push(route);
        this.clients.push(structuredClone(body));
        return send(200);
      }
      case 'POST /clients/update': {
        const i = this.clients.findIndex((c) => c.name === body.name);
        if (i === -1) return send(400, `client "${body.name}" not found`);
        this.writes.push(route);
        if (this.faults.failUpdates) {
          this.faults.failUpdates--;
          return send(500, 'internal error');
        }
        // The whole client is replaced by `data`: fields left out are gone.
        if (!this.faults.dropUpdates) this.clients[i] = structuredClone(body.data);
        return send(200);
      }
      case 'GET /blocked_services/all':
        return send(200, { blocked_services: FAKE_SERVICES, groups: [{ id: 'video' }, { id: 'gaming' }, { id: 'social_network' }] });
      case 'GET /filtering/status':
        return send(200, { enabled: true, interval: 24, user_rules: this.userRules, filters: this.filters, whitelist_filters: null });
      case 'POST /filtering/set_rules':
        this.writes.push(route);
        this.userRules = [...body.rules];
        return send(200);
      case 'POST /filtering/add_url':
        this.writes.push(route);
        if (this.filters.some((f) => f.url === body.url)) return send(400, 'filter URL already added');
        this.filters.push({ name: body.name, url: body.url });
        return send(200);
      case 'GET /querylog': {
        const limit = Number(url.searchParams.get('limit') ?? 500);
        const olderThan = url.searchParams.get('older_than');
        const sorted = [...this.querylog].sort((a, b) => b.time.localeCompare(a.time));
        const page = sorted.filter((q) => !olderThan || q.time < olderThan).slice(0, limit);
        return send(200, { data: page, oldest: page.at(-1)?.time ?? '' });
      }
      case 'GET /dns_info':
        return send(200, this.dnsConfig);
      case 'POST /dns_config':
        this.writes.push(route);
        this.dnsConfig = { ...this.dnsConfig, ...body };
        return send(200);
      case 'GET /querylog/config':
        return send(200, this.querylogConfig);
      case 'PUT /querylog/config/update':
        this.writes.push(route);
        this.querylogConfig = body;
        return send(200);
      case 'GET /stats/config':
        return send(200, this.statsConfig);
      case 'PUT /stats/config/update':
        this.writes.push(route);
        this.statsConfig = body;
        return send(200);
      default:
        return send(404, `fake AdGuard has no ${route}`);
    }
  }

  /** Adds a query as AdGuard would log it. */
  logQuery(time: Date, clientName: string, domain: string, ip = '192.168.1.50') {
    this.querylog.push({ time: time.toISOString(), client: ip, client_info: { name: clientName }, question: { name: domain, type: 'A' } });
  }
}
