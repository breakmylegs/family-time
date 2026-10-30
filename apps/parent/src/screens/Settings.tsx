import type { ChildStatus, ChildSummary, Me } from '@family-time/schemas';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { HelpButton } from '../help/HelpButton';
import { useHelp } from '../help/HelpContext';
import { SYNC } from '../help/rightNow';
import { Icon } from '../icons';
import { alertState, turnOffAlerts, turnOnAlerts, type AlertState } from '../push';
import { navigate } from '../router';
import { Notice, roleName } from '../ui';

const ALERT_TEXT: Record<AlertState, string> = {
  on: 'On for this phone.',
  off: "Get told when a change isn't confirmed, or a device goes quiet.",
  denied: 'Alerts are blocked for Family time in your phone settings. Allow them there, then come back.',
  'install-first': 'On iPhone, add Family time to your Home Screen first: tap Share in Safari, then Add to Home Screen. Then open it from there.',
  unsupported: "This browser can't show alerts. Try Safari on iPhone, from the Home Screen.",
};

export function Settings({ me, kids, onSignedOut }: { me: Me; kids: ChildSummary[]; onSignedOut: () => void }) {
  const help = useHelp();
  const [statuses, setStatuses] = useState<ChildStatus[]>([]);
  const [alerts, setAlerts] = useState<AlertState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all(kids.map((k) => api<ChildStatus>('GET', `/api/children/${k.id}/status`)))
      .then(setStatuses)
      .catch((err: Error) => setError(err.message));
  }, [kids]);

  useEffect(() => {
    alertState()
      .then(setAlerts)
      .catch(() => setAlerts('unsupported'));
  }, []);

  const toggleAlerts = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setAlerts(alerts === 'on' ? await turnOffAlerts() : await turnOnAlerts());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      await api('POST', '/api/auth/logout');
      onSignedOut();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const devices = statuses.flatMap((s) => s.devices.map((d) => ({ ...d, child: s.child.name })));
  const canAlert = alerts === 'on' || alerts === 'off';
  const getsAlerts = me.role === 'owner' || me.role === 'parent';

  return (
    <main className="screen" aria-label="Settings">
      <div className="shell">
        <div className="shell-inner">
          <h1 className="child-name">Settings</h1>
          <p className="now-line">
            {me.householdName}. You are signed in as {roleName[me.role]?.toLowerCase() ?? me.role}.
          </p>
        </div>
      </div>

      <section className="sec" aria-labelledby="family">
        <div className="sec-head">
          <h2 id="family">Family</h2>
          <HelpButton topic="people-and-roles" label="People and what they can do" />
        </div>
        <div className="group">
          {me.capabilities.includes('people.view') ? (
            <button type="button" className="row" onClick={() => navigate('/people')}>
              <span className="row-icon">
                <Icon name="users" />
              </span>
              <span className="row-text">People</span>
              <span className="row-end">
                <Icon name="right" />
              </span>
            </button>
          ) : null}
          {kids.map((k) => (
            <div key={k.id} className="row">
              <span className="row-icon">
                <Icon name="heart" />
              </span>
              <span className="row-text">
                {k.name}
                <small>{k.devices === 1 ? '1 device' : `${k.devices} devices`}</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="sec" aria-labelledby="devices">
        <div className="sec-head">
          <h2 id="devices">Devices</h2>
          <HelpButton topic="device-status" label="Is it working yet?" />
        </div>
        <div className="group">
          {devices.map((d) => (
            <div key={d.id} className="row">
              <span className="row-icon">
                <Icon name="device" />
              </span>
              <span className="row-text">
                {d.label}
                <small>{d.quietSince ? 'Gone quiet. Its apps are not being managed.' : SYNC[d.sync]}</small>
              </span>
            </div>
          ))}
          {!devices.length ? <p className="empty">No devices yet. Whoever set up Family time adds them on the server.</p> : null}
        </div>
      </section>

      {getsAlerts ? (
        <section className="sec" aria-labelledby="alerts">
          <div className="sec-head">
            <h2 id="alerts">Alerts</h2>
            <HelpButton topic="alerts" label="Alerts on your phone" />
          </div>
          <div className="group">
            <div className="row">
              <span className="row-icon">
                <Icon name="bell" />
              </span>
              <span className="row-text">
                Alerts on this phone
                <small>{alerts ? ALERT_TEXT[alerts] : ''}</small>
              </span>
            </div>
          </div>
          {canAlert ? (
            <button type="button" className={`btn ${alerts === 'on' ? 'btn-quiet' : 'btn-primary'}`} style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={() => void toggleAlerts()}>
              {alerts === 'on' ? 'Turn off alerts' : 'Turn on alerts'}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="sec" aria-labelledby="help-icons">
        <div className="sec-head">
          <h2 id="help-icons">Help</h2>
        </div>
        <div className="group">
          <div className="row">
            <span className="row-icon">
              <Icon name="help" />
            </span>
            <span className="row-text">
              Show help buttons
              <small>The (?) next to each feature, explaining what it does and why.</small>
            </span>
            <span className="row-end">
              <button type="button" className="switch" role="switch" aria-checked={help.iconsOn} aria-label="Show help buttons" onClick={() => help.setIconsOn(!help.iconsOn)} />
            </span>
          </div>
        </div>
      </section>

      <div className="sec" style={{ marginTop: 28 }}>
        <button type="button" className="btn btn-quiet" style={{ width: '100%' }} onClick={() => void signOut()}>
          Sign out
        </button>
        <Notice>{error}</Notice>
      </div>
    </main>
  );
}
