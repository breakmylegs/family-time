import type { ChildStatus, ChildSummary, Me } from '@family-time/schemas';
import { useEffect, useState } from 'react';
import { api, ApiFailure } from '../api';
import { HelpButton } from '../help/HelpButton';
import { useHelp } from '../help/HelpContext';
import { SYNC } from '../help/rightNow';
import { Icon } from '../icons';
import { alertState, turnOffAlerts, turnOnAlerts, type AlertState } from '../push';
import { navigate } from '../router';
import { Notice } from '../ui';

const ROLE_PHRASE: Record<string, string> = { owner: 'an owner', parent: 'a parent', carer: 'a carer' };

const ALERT_TEXT: Record<AlertState, string> = {
  on: 'On for this phone.',
  off: "Get a message when a change doesn't reach a device, or a device stops checking in.",
  denied: "Alerts are turned off for Family time. Open your phone's Settings, tap Notifications, then Family time, and turn on Allow Notifications. Then come back here.",
  'install-first': 'On iPhone and iPad, add Family time to your Home Screen first: tap Share in Safari, then Add to Home Screen. Then open it from there.',
  unsupported: "This browser can't show alerts. On iPhone, open Family time from your Home Screen. On other phones, try Chrome or Firefox.",
};

export function Settings({ me, kids, onSignedOut }: { me: Me; kids: ChildSummary[]; onSignedOut: () => void }) {
  const help = useHelp();
  const [statuses, setStatuses] = useState<ChildStatus[]>();
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
      // The browser's own push errors mean nothing to a parent; ours already say what to do.
      setError(err instanceof ApiFailure ? err.message : "Couldn't change alerts on this phone. Check you opened Family time from your Home Screen, then try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try {
      // A phone that is signed out (or handed on) stops getting this person's alerts.
      if (alerts === 'on') await turnOffAlerts().catch(() => undefined);
      await api('POST', '/api/auth/logout');
      onSignedOut();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const devices = (statuses ?? []).flatMap((s) => s.devices.map((d) => ({ ...d, child: s.child.name })));
  const canAlert = alerts === 'on' || alerts === 'off';
  const getsAlerts = me.role === 'owner' || me.role === 'parent';

  return (
    <main className="screen" aria-label="Settings">
      <div className="shell">
        <div className="shell-inner">
          <h1 className="child-name">Settings</h1>
          <p className="now-line">
            {me.householdName}. You&apos;re signed in as {me.displayName}, {ROLE_PHRASE[me.role] ?? me.role}.
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
          {me.capabilities.includes('system.manage') ? (
            <button type="button" className="row" onClick={() => navigate('/ledger')}>
              <span className="row-icon">
                <Icon name="list" />
              </span>
              <span className="row-text">
                Ledger
                <small>Every change to time, money and points</small>
              </span>
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
                <small>{k.devices === 0 ? 'No devices yet' : k.devices === 1 ? '1 device' : `${k.devices} devices`}</small>
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
                <small>{d.quietSince ? "Gone quiet. Family time can't block apps on it until it's back on home Wi-Fi." : SYNC[d.sync]}</small>
              </span>
            </div>
          ))}
          {!statuses ? <p className="empty">Checking devices.</p> : !devices.length ? <p className="empty">No devices yet. Whoever set up Family time can add them.</p> : null}
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
