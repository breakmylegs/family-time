// Settings, AI and connected apps (Phase 7, ADR 0016), for the owner. Everything starts off. Keys
// go in and never come back out: only their last four characters show. Each feature says what it
// sends, has its own monthly limit, and works without AI too.
import type { AiFeatureSetting, AiSettings as View, McpClientEntry, McpServerEntry } from '@family-time/schemas';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { pence } from '../economy/data';
import { HelpButton } from '../help/HelpButton';
import { Icon } from '../icons';
import { useToast } from '../toast';
import { Sheet } from './Sheet';

type ProviderView = View['providers'][number];

const LEVEL = { 1: 'Sends totals and names only, never anything a child types', 2: "Sends what you type, with children's names replaced", 3: 'Never leaves your server' } as Record<number, string>;

/** Hundredths of a penny, in words: "under 1p", "12p". */
const spent = (centipence: number) => (centipence < 100 ? (centipence ? 'under 1p' : 'nothing') : pence(Math.round(centipence / 100)));

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function AiSettings({ origin }: { origin: string }) {
  const toast = useToast();
  const [view, setView] = useState<View>();
  const [clients, setClients] = useState<McpClientEntry[]>([]);
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [keyFor, setKeyFor] = useState<{ provider: ProviderView; from: HTMLElement | null }>();
  const [weatherOpen, setWeatherOpen] = useState<HTMLElement | null>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setView(await api<View>('GET', '/api/ai'));
      setClients(await api<McpClientEntry[]>('GET', '/api/mcp/clients'));
      setServers(await api<McpServerEntry[]>('GET', '/api/mcp/servers'));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return error ? <p className="empty" role="alert">{error}</p> : null;

  const settingsOf = (v: View) => ({ on: v.on, features: Object.fromEntries(v.features.map((f) => [f.id, f.setting])), mcp: v.mcp });
  const save = async (next: ReturnType<typeof settingsOf>) => {
    setError(undefined);
    try {
      setView(await api<View>('PUT', '/api/ai', next));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const setFeature = (id: string, change: Partial<AiFeatureSetting>) => {
    const s = settingsOf(view);
    const f = { ...s.features[id]!, ...change };
    // A provider change picks its first model, so a feature never points at another provider's.
    if (change.provider !== undefined) f.model = view.providers.find((p) => p.id === change.provider)?.models[0] ?? null;
    void save({ ...s, features: { ...s.features, [id]: f } });
  };
  const withKeys = view.providers.filter((p) => p.key);

  const removeClient = async (c: McpClientEntry) => {
    try {
      await api('DELETE', `/api/mcp/clients/${c.id}`);
      toast(`Removed ${c.name}. It can't see or suggest anything now.`);
      void load();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <section className="sec" aria-labelledby="ai">
      <div className="sec-head">
        <h2 id="ai">AI and connected apps</h2>
        <HelpButton topic="ai-settings" label="AI in Family time" />
      </div>
      {!view.available ? (
        <p className="list-note">AI is not set up on this server. Run ./scripts/init.sh, then ./scripts/update.sh, to make the key that keeps AI keys safe. Everything else works without it.</p>
      ) : null}
      <div className="group">
        <div className="row">
          <span className="row-icon">
            <Icon name="star" />
          </span>
          <span className="row-text">
            Use AI
            <small>Only ever suggests. Every suggestion is a card a parent approves.</small>
          </span>
          <span className="row-end">
            <Switch on={view.on} label="Use AI" disabled={!view.available} onChange={(on) => void save({ ...settingsOf(view), on })} />
          </span>
        </div>
      </div>

      {view.on ? (
        <>
          <h3 className="sub-head">Providers</h3>
          <div className="group">
            {view.providers.map((p) => (
              <div key={p.id} className="row">
                <span className="row-text">
                  {p.label}
                  <small>{p.key ? (p.local ? 'Ready' : `Key ending ${p.key.lastFour}`) : 'Not set up'}</small>
                </span>
                <span className="row-end">
                  <button type="button" className="btn btn-quiet row-btn" onClick={(e) => setKeyFor({ provider: p, from: e.currentTarget })}>
                    {p.key ? 'Change key' : 'Add key'}
                  </button>
                </span>
              </div>
            ))}
          </div>

          <h3 className="sub-head">Features</h3>
          {view.features.map((f) => (
            <div key={f.id} className="group ai-feature">
              <div className="row">
                <span className="row-text">
                  {f.title}
                  <small>
                    {f.does} {LEVEL[f.level]}. Spent this month: {spent(view.spentThisMonth[f.id] ?? 0)} of {pence(f.setting.monthlyCapPence)}.
                  </small>
                </span>
                <span className="row-end">
                  <Switch on={f.setting.on} label={f.title} disabled={!withKeys.length} onChange={(on) => setFeature(f.id, on && !f.setting.provider ? { on, provider: withKeys[0]!.id } : { on })} />
                </span>
              </div>
              {f.setting.on ? (
                <div className="form ai-form">
                  <p className="hint">Sends: {f.sends}</p>
                  <label htmlFor={`prov-${f.id}`}>Provider</label>
                  <select id={`prov-${f.id}`} className="field" value={f.setting.provider ?? ''} onChange={(e) => setFeature(f.id, { provider: e.target.value as AiFeatureSetting['provider'] })}>
                    {withKeys.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`model-${f.id}`}>Model</label>
                  <select id={`model-${f.id}`} className="field" value={f.setting.model ?? ''} onChange={(e) => setFeature(f.id, { model: e.target.value })}>
                    {(view.providers.find((p) => p.id === f.setting.provider)?.models ?? []).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`cap-${f.id}`}>Monthly limit, in pence</label>
                  <input id={`cap-${f.id}`} className="field tnum" type="number" inputMode="numeric" min={0} max={10000} defaultValue={f.setting.monthlyCapPence} onBlur={(e) => setFeature(f.id, { monthlyCapPence: Math.max(0, Math.min(10000, Math.round(Number(e.target.value) || 0))) })} />
                  {f.level === 2 ? (
                    <div className="row">
                      <span className="row-text">
                        Send what you type to a cloud provider
                        <small>Children&apos;s names are replaced by Child A, Child B before it leaves. Not needed for Ollama on your own server.</small>
                      </span>
                      <span className="row-end">
                        <Switch on={f.setting.levelTwo} label="Send what you type to a cloud provider" onChange={(levelTwo) => setFeature(f.id, { levelTwo })} />
                      </span>
                    </div>
                  ) : null}
                  <p className="hint">Without AI: {f.fallback}</p>
                </div>
              ) : null}
            </div>
          ))}

          <h3 className="sub-head">Weather for job ideas</h3>
          <div className="group">
            {servers.map((s) => (
              <div key={s.id} className="row">
                <span className="row-text">
                  {s.name}
                  <small>
                    {s.approved ? 'Approved' : 'Not approved'}. {s.tools.map((t) => t.name).join(', ') || 'No tools approved'}.
                  </small>
                </span>
                <span className="row-end">
                  <button
                    type="button"
                    className="btn btn-quiet row-btn"
                    onClick={async () => {
                      await api('DELETE', `/api/mcp/servers/${s.id}`).catch((err: Error) => toast(err.message));
                      void load();
                    }}
                  >
                    Remove
                  </button>
                </span>
              </div>
            ))}
            {!servers.length ? <p className="empty">None. Job ideas work without the weather.</p> : null}
          </div>
          <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={(e) => setWeatherOpen(e.currentTarget)}>
            <Icon name="plus" />
            Add a weather service
          </button>
        </>
      ) : null}

      <h3 className="sub-head">Connected apps (MCP)</h3>
      <div className="group">
        <div className="row">
          <span className="row-text">
            Let apps connect
            <small>An assistant such as Claude can see the family&apos;s status and suggest changes. Give it this address: {origin}/mcp</small>
          </span>
          <span className="row-end">
            <Switch on={view.mcp.on} label="Let apps connect" disabled={!view.available} onChange={(on) => void save({ ...settingsOf(view), mcp: { on } })} />
          </span>
        </div>
        {clients.map((c) => (
          <div key={c.id} className="row">
            <span className="row-text">
              {c.name}
              <small>
                {c.allowed ? (c.scopes.includes('propose') ? 'Can see and suggest' : 'Can see') : 'Not allowed yet'}. {c.lastUsed ? `Last used ${new Date(c.lastUsed).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}` : 'Not used yet'}.
              </small>
            </span>
            <span className="row-end">
              <button type="button" className="btn btn-quiet row-btn" aria-label={`Remove ${c.name}`} onClick={() => void removeClient(c)}>
                Remove
              </button>
            </span>
          </div>
        ))}
      </div>
      {error ? (
        <p className="empty" role="alert">
          {error}
        </p>
      ) : null}

      {keyFor ? (
        <KeySheet
          provider={keyFor.provider}
          from={keyFor.from}
          onClose={() => setKeyFor(undefined)}
          onSaved={(v) => {
            setView(v);
            setKeyFor(undefined);
            toast('Saved. The key is locked away on your server. Only its last four characters ever show.');
          }}
        />
      ) : null}
      {weatherOpen !== undefined ? (
        <WeatherSheet
          from={weatherOpen}
          onClose={() => setWeatherOpen(undefined)}
          onSaved={() => {
            setWeatherOpen(undefined);
            void load();
          }}
        />
      ) : null}
    </section>
  );
}

function KeySheet({ provider, from, onClose, onSaved }: { provider: ProviderView; from: HTMLElement | null; onClose: () => void; onSaved: (v: View) => void }) {
  const [key, setKey] = useState('');
  const [paidTier, setPaidTier] = useState(provider.key?.paidTier ?? false);
  const [region, setRegion] = useState(String(provider.key?.options['region'] ?? 'eu-west-2'));
  const [baseUrl, setBaseUrl] = useState(String(provider.key?.options['baseUrl'] ?? 'http://192.168.1.20:11434/v1'));
  const [error, setError] = useState<string>();

  const save = async () => {
    const options = provider.id === 'bedrock' ? { region } : provider.id === 'ollama' ? { baseUrl } : {};
    try {
      onSaved(await api<View>('PUT', `/api/ai/keys/${provider.id}`, { key: key.trim() || null, paidTier, options }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const remove = async () => {
    try {
      onSaved(await api<View>('DELETE', `/api/ai/keys/${provider.id}`));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={provider.label}
      returnFocus={from}
      error={error}
      sub={provider.key && !provider.local ? `A key ending ${provider.key.lastFour} is saved. Paste a new one to replace it, or leave it empty to keep it.` : undefined}
      footer={
        provider.key ? (
          <button type="button" className="btn btn-quiet" onClick={() => void remove()}>
            Remove {provider.label}
          </button>
        ) : undefined
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {provider.id === 'ollama' ? (
          <>
            <label htmlFor="key-base">Ollama&apos;s address</label>
            <input id="key-base" className="field" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} autoComplete="off" />
          </>
        ) : (
          <>
            <label htmlFor="key-value">{provider.id === 'bedrock' ? 'Session credentials' : 'API key'}</label>
            <input id="key-value" className="field" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
            {provider.id === 'bedrock' ? (
              <>
                <p className="hint">Paste the JSON from your AWS session, with accessKeyId, secretAccessKey and sessionToken. Session credentials only, never a long-lived key.</p>
                <label htmlFor="key-region">Region</label>
                <input id="key-region" className="field" value={region} onChange={(e) => setRegion(e.target.value)} autoComplete="off" />
              </>
            ) : null}
            {provider.id === 'google' ? (
              <div className="row">
                <span className="row-text">
                  This key is on a paid plan
                  <small>Google uses free-plan requests to improve its products, so Family time only uses a paid-plan key.</small>
                </span>
                <span className="row-end">
                  <Switch on={paidTier} label="This key is on a paid plan" onChange={setPaidTier} />
                </span>
              </div>
            ) : null}
          </>
        )}
        <button type="submit" className="btn btn-primary">
          Save
        </button>
      </form>
    </Sheet>
  );
}

function WeatherSheet({ from, onClose, onSaved }: { from: HTMLElement | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('Weather');
  const [url, setUrl] = useState('');
  const [tool, setTool] = useState('get_forecast');
  const [place, setPlace] = useState('');
  const [error, setError] = useState<string>();
  const save = async () => {
    try {
      await api('POST', '/api/mcp/servers', { name, url: url.trim(), approved: true, tools: [{ name: tool.trim(), arguments: place.trim() ? { location: place.trim() } : {} }] });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Sheet open onClose={onClose} title="Add a weather service" returnFocus={from} error={error} sub="An MCP server that gives a forecast. Family time only calls the tool you name here, and only reads what it says.">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor="w-name">Name</label>
        <input id="w-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="w-url">Address</label>
        <input id="w-url" className="field" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        <label htmlFor="w-tool">Tool to call</label>
        <input id="w-tool" className="field" value={tool} onChange={(e) => setTool(e.target.value)} />
        <label htmlFor="w-place">Your town</label>
        <input id="w-place" className="field" value={place} onChange={(e) => setPlace(e.target.value)} />
        <button type="submit" className="btn btn-primary">
          Approve and add
        </button>
      </form>
    </Sheet>
  );
}
