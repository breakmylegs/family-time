// The owner's System page (brief Part 10, ADR 0017): how the server is, the last backup, what the
// pilot phase has switched on, how long data is kept, release notes, the audit log, and Export.
import type { AuditEntry, AuditPage, SystemView } from '@family-time/schemas';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useFetched } from '../economy/data';
import { Icon } from '../icons';
import { navigate } from '../router';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

function uptime(seconds: number) {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} ${d === 1 ? 'day' : 'days'}, ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const FEATURE_WORDS: Record<string, string> = { economy: 'Allowance and jobs', bonus: 'Unused-time bonus', goal: 'Savings goal', transitions: 'Stopping points and the whole family', taper: 'Agreed reduction steps' };

const SYNC_WORDS: Record<string, string> = { confirmed: 'Working', pending: 'Starting', 'not-confirmed': 'Not confirmed', never: 'Not set up yet' };

const ACTIONS = [
  { value: '', label: 'Everything' },
  { value: 'control', label: 'Allow, Block and Pause' },
  { value: 'auth', label: 'Signing in' },
  { value: 'people', label: 'People' },
  { value: 'proposal', label: 'Suggestions' },
  { value: 'mcp', label: 'Connected apps' },
  { value: 'ai', label: 'AI settings' },
  { value: 'backup', label: 'Backups' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'device', label: 'Devices' },
  { value: 'policy', label: 'Rules for groups' },
  { value: 'service', label: 'Apps and groups' },
  { value: 'schedule', label: 'Schedules' },
  { value: 'family', label: 'The whole family' },
  { value: 'retention', label: 'Data cleared' },
];

/** The audit log's action codes in words, where there are some. */
const ACTION_WORDS: Record<string, string> = {
  'control.allow': 'Allowed an app',
  'control.block': 'Blocked an app',
  'control.pause': 'Paused everything',
  'control.resume': 'Resumed',
  'control.normal': 'Back to normal',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.oidc_linked': 'Linked a sign-in service account',
  'auth.oidc_unlinked': 'Unlinked a sign-in service account',
  'auth.oidc_failed': 'Sign-in service sign-in not confirmed',
  'auth.oidc_unknown': 'Sign-in service account not linked here',
  'auth.sso_set': 'Sign-in service set up',
  'auth.sso_off': 'Sign-in service switched off',
  'auth.rate_limited': 'Too many tries, slowed down',
  'system.export': "Exported the family's data",
  'backup.done': 'Backup done',
  'backup.failed': "Backup didn't finish",
  'maintenance.on': 'Maintenance mode on',
  'maintenance.off': 'Maintenance mode off',
  'retention.swept': 'Cleared old data',
  'proposal.made': 'Suggestion made',
  'proposal.approved': 'Suggestion approved',
  'proposal.declined': 'Suggestion dismissed',
  'mcp.tool': 'Connected app looked or suggested',
  'mcp.client.allowed': 'Connected app allowed',
  'mcp.client.removed': 'Connected app removed',
  'ai.settings': 'AI settings changed',
  'ai.key.saved': 'AI key saved',
  'ai.key.removed': 'AI key removed',
  'pilot.phase': 'Pilot phase changed',
  'device.added': 'Device added',
  'device.changed': 'Device changed',
  'device.removed': 'Device removed',
  'policy.changed': 'Rule for a group changed',
  'service.group': "App's group changed",
  'schedule.added': 'Schedule added',
  'schedule.changed': 'Schedule changed',
  'schedule.removed': 'Schedule removed',
  'family.challenge.set': 'Family challenge set',
  'family.challenge.ended': 'Family challenge ended',
  'family.stopping_point': 'Time to find a stopping point changed',
  'goal.set': 'Savings goal set',
};
const actionWords = (a: string) => ACTION_WORDS[a] ?? a;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span className="row-text">
        {label}
        <small>{value}</small>
      </span>
    </div>
  );
}

export function System() {
  const { data: s, error, reload } = useFetched<SystemView>('/api/system');
  const [action, setAction] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [older, setOlder] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string>();

  const loadAudit = async (before?: string) => {
    setAuditError(undefined);
    try {
      const q = new URLSearchParams({ ...(action ? { action } : {}), ...(before ? { before } : {}) });
      const page = await api<AuditPage>('GET', `/api/audit?${q}`);
      setEntries((e) => (before ? [...e, ...page.entries] : page.entries));
      setOlder(page.older);
    } catch (err) {
      setAuditError((err as Error).message);
    }
  };
  useEffect(() => {
    void loadAudit();
    // Reload from the top when the filter changes.
  }, [action]);

  const failing = s?.readiness.checks.filter((c) => !c.ok) ?? [];
  const b = s?.lastBackup;

  return (
    <main className="screen" aria-label="System">
      <div className="large">
        <button type="button" className="back" onClick={() => navigate('/settings')}>
          <Icon name="left" />
          Settings
        </button>
        <h1>System</h1>
        <p>How the server is, and what it keeps.</p>
      </div>

      {error && !s ? (
        <div className="sec">
          <p className="empty-large" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={() => void reload()}>
            Try again
          </button>
        </div>
      ) : null}
      {!s && !error ? <p className="empty-large">Loading.</p> : null}

      {s ? (
        <>
          {s.maintenance.on ? (
            <p className="sh-error ledger-warning" role="status">
              Maintenance mode is on.{s.maintenance.message ? ` The family sees "${s.maintenance.message}"` : ''} To turn it off, run ./scripts/ft.sh maintenance --state off on the server.
            </p>
          ) : null}

          <section className="sec" aria-labelledby="sys-health">
            <div className="sec-head">
              <h2 id="sys-health">Health</h2>
            </div>
            <div className="group">
              <Row label="Status" value={failing.length ? `Needs a look: ${failing.map((c) => `${c.name} (${c.detail ?? 'failed'})`).join(', ')}. Run ./scripts/verify.sh on the server for details.` : 'Everything is working'} />
              <Row label="Version" value={`${s.version.app}, commit ${s.version.commit.slice(0, 12)}, database ${s.version.schema}`} />
              <Row label="Running for" value={uptime(s.uptimeSeconds)} />
              <Row label="Ledger" value={s.ledger.adapter === 'besu' ? `Besu chain${s.ledger.contract ? '' : ', no contract yet'}${s.ledger.waiting ? `, ${s.ledger.waiting} entries on their way` : ''}${s.ledger.failed ? `, ${s.ledger.failed} refused` : ''}` : 'Postgres, sealed entry by entry'} />
            </div>
          </section>

          <section className="sec" aria-labelledby="sys-backup">
            <div className="sec-head">
              <h2 id="sys-backup">Last backup</h2>
            </div>
            <div className="group">
              {b ? (
                <Row
                  label={b.ok ? `Done ${when(b.at)}` : `Didn't finish, ${when(b.at)}`}
                  value={b.ok ? `Database ${b.bytes ? size(b.bytes) : ''}, snapshot ${b.snapshot ?? ''}` : `${(b.problem ?? 'No reason given').replace(/[.!?]?$/, '.')}${b.lastOkAt ? ` The last one that worked was ${when(b.lastOkAt)}.` : ''} Run ./scripts/backup.sh on the server to see why.`}
                />
              ) : (
                <p className="empty">No backup yet. Set them up with docs/setup/backup.md, then run ./scripts/backup.sh on the server.</p>
              )}
            </div>
          </section>

          <section className="sec" aria-labelledby="sys-adguard">
            <div className="sec-head">
              <h2 id="sys-adguard">AdGuard</h2>
            </div>
            <div className="group">
              {!s.adguard.setUp ? <p className="empty">Not set up yet. Run ./scripts/ft.sh adguard-setup on the server.</p> : null}
              {s.adguard.devices.map((d) => (
                <Row key={d.label} label={d.label} value={`${SYNC_WORDS[d.state] ?? d.state}${d.confirmedAt ? `, confirmed ${when(d.confirmedAt)}` : ''}${d.lastError ? `. ${d.lastError}` : ''}`} />
              ))}
              {s.adguard.setUp && !s.adguard.devices.length ? <p className="empty">No devices yet.</p> : null}
            </div>
          </section>

          <section className="sec" aria-labelledby="sys-flags">
            <div className="sec-head">
              <h2 id="sys-flags">What is switched on</h2>
            </div>
            <div className="group">
              <Row label="Pilot phase" value={s.pilot.phase} />
              {Object.entries(s.pilot.features).map(([k, on]) => (
                <Row key={k} label={FEATURE_WORDS[k] ?? k} value={on ? 'On' : 'Off'} />
              ))}
              <Row label="AI" value={s.ai.on ? 'On' : 'Off'} />
              <Row label="Connected apps" value={s.ai.mcp ? 'On' : 'Off'} />
            </div>
          </section>

          <section className="sec" aria-labelledby="sys-kept">
            <div className="sec-head">
              <h2 id="sys-kept">How long data is kept</h2>
            </div>
            <ul className="group plain-list">
              {s.retention.map((r) => (
                <li key={r.what}>{r.what}</li>
              ))}
            </ul>
            <a className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} href="/api/export" download>
              <Icon name="down" />
              Export the family's data
            </a>
          </section>

          <section className="sec" aria-labelledby="sys-notes">
            <div className="sec-head">
              <h2 id="sys-notes">What's new</h2>
            </div>
            {s.releases.slice(0, 3).map((r) => (
              <div key={r.version} className="group release">
                <h3>
                  {r.version}
                  {r.title ? <small> {r.title}</small> : null}
                </h3>
                <ul className="plain-list">
                  {r.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </>
      ) : null}

      <section className="sec" aria-labelledby="sys-audit">
        <div className="sec-head">
          <h2 id="sys-audit">Audit log</h2>
        </div>
        <div className="form audit-filter">
          <label htmlFor="audit-action">Show</label>
          <select id="audit-action" className="field" value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <ol className="group ledger audit">
          {entries.map((e) => (
            <li key={e.id}>
              <span>
                {actionWords(e.action)}
                <span className="when">
                  {e.by}, {when(e.at)}
                </span>
              </span>
            </li>
          ))}
          {!entries.length && !auditError ? <li className="empty">Nothing here.</li> : null}
        </ol>
        {auditError ? (
          <p className="empty" role="alert">
            {auditError}
          </p>
        ) : null}
        {older ? (
          <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={() => void loadAudit(older)}>
            Show older
          </button>
        ) : null}
        <a className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} href={`/api/audit.csv${action ? `?action=${encodeURIComponent(action)}` : ''}`} download>
          <Icon name="down" />
          Download as a spreadsheet
        </a>
      </section>
    </main>
  );
}
