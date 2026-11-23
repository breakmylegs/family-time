import type { AuthState, Me } from '@family-time/schemas';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Sheet } from './components/Sheet';
import { TabBar } from './components/TabBar';
import { useChildren, useChildStatus } from './control/useChildStatus';
import { LiveVersion, usePilot, useWaiting, useWeek } from './economy/data';
import { HelpProvider } from './help/HelpContext';
import { useLive } from './live';
import { navigate, usePath } from './router';
import { MaintenanceBanner } from './components/MaintenanceBanner';
import { Approvals } from './screens/Approvals';
import { Consent } from './screens/Consent';
import { Control } from './screens/Control';
import { Family } from './screens/Family';
import { Home } from './screens/Home';
import { Ledger } from './screens/Ledger';
import { Join } from './screens/Join';
import { People } from './screens/People';
import { Settings } from './screens/Settings';
import { Setup } from './screens/Setup';
import { System } from './screens/System';
import { SignIn } from './screens/SignIn';
import { Tasks } from './screens/Tasks';
import { ToastProvider } from './toast';
import { Notice, Page, radioKeys, Shell } from './ui';

export function App() {
  const path = usePath();
  const [state, setState] = useState<AuthState | undefined>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setState(await api<AuthState>('GET', '/api/auth/state'));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signedIn = (me: Me) => {
    setState({ setup: 'ready', me, sso: state?.sso ?? false, ssoName: state?.ssoName ?? null });
    // Replace, so Back does not return to a used invite link. Signing in to connect an app goes
    // back to the consent screen, with the app's request as it was.
    navigate(location.pathname === '/oauth/authorize' ? location.pathname + location.search : '/', { replace: true });
  };

  if (path === '/join') return <Join onSignedIn={signedIn} />;

  if (error) {
    return (
      <Page>
        <Shell title="Family time" />
        <Notice>{error}</Notice>
      </Page>
    );
  }
  if (!state) return <Page>{null}</Page>;

  if (!state.me) return <SignIn setup={state.setup} sso={state.sso} ssoName={state.ssoName} onSignedIn={signedIn} />;

  const signedOut = () => {
    setState({ setup: 'ready', me: null, sso: state?.sso ?? false, ssoName: state?.ssoName ?? null });
    navigate('/');
  };
  return <SignedIn me={state.me} path={path} onSignedOut={signedOut} />;
}

function SignedIn(props: { me: Me; path: string; onSignedOut: () => void }) {
  // Every live change bumps this, and every screen's data fetches again.
  const [version, setVersion] = useState(0);
  return (
    <LiveVersion.Provider value={version}>
      <Screens {...props} onLive={() => setVersion((v) => v + 1)} />
    </LiveVersion.Provider>
  );
}

function Screens({ me, path, onSignedOut, onLive }: { me: Me; path: string; onSignedOut: () => void; onLive: () => void }) {
  const { children: kids, childId, pick, error: kidsError } = useChildren(true);
  const cs = useChildStatus(childId);
  useLive(() => {
    void cs.refresh();
    onLive();
  });
  const [picking, setPicking] = useState<HTMLElement | null>(null);
  const pilot = usePilot().data;
  const economy = Boolean(pilot?.features.economy);
  // Undefined until the first answer, so the badge never flashes a zero.
  const waiting = useWaiting(true).data?.waiting;
  const week = useWeek(economy ? childId : undefined).data;
  const child = cs.status ? { name: cs.status.child.name, pronouns: cs.status.child.pronouns } : { name: 'your child', pronouns: 'they' as const };
  const can = (c: string) => me.capabilities.includes(c);

  let screen;
  if (path === '/oauth/authorize') screen = <Consent me={me} />;
  else if (path === '/people' && can('people.view')) screen = <People me={me} />;
  else if (path === '/settings') screen = <Settings me={me} kids={kids ?? []} onSignedOut={onSignedOut} />;
  else if (path === '/ledger' && can('system.manage')) screen = <Ledger />;
  else if (path === '/system' && can('system.manage')) screen = <System />;
  else if (path === '/setup' && can('system.manage')) screen = <Setup />;
  // Suggestions from AI and connected apps arrive here even before the economy is switched on.
  else if ((economy || waiting) && path === '/approvals' && can('approvals.decide')) screen = <Approvals me={me} />;
  else if (economy && path === '/tasks') screen = <Tasks kids={kids ?? []} canEdit={can('rules.edit')} />;
  else if (economy && path === '/family') screen = <Family kids={kids ?? []} childId={childId} canEdit={can('rules.edit')} onSwitchChild={setPicking} />;
  else if (kidsError || (cs.error && !cs.status)) screen = <Waiting error={kidsError ?? cs.error} onRetry={() => void cs.refresh()} />;
  else if (kids && !kids.length) screen = <Home me={me} onSignedOut={onSignedOut} />;
  else if (kids && cs.status)
    screen = (
      <Control
        key={cs.status.child.id}
        me={me}
        kids={kids}
        status={cs.status}
        history={cs.history}
        setStatus={cs.setStatus}
        accept={cs.accept}
        setHistory={cs.setHistory}
        refresh={cs.refresh}
        offline={cs.error}
        week={economy ? week : undefined}
        onSwitchChild={setPicking}
      />
    );
  else screen = <Waiting />;

  return (
    <ToastProvider>
      <HelpProvider child={child} status={cs.status} week={week}>
        <MaintenanceBanner />
        {screen}
        {path === '/people' || path === '/oauth/authorize' ? null : (
          <TabBar path={path === '/ledger' || path === '/system' || path === '/setup' ? '/settings' : ['/settings', '/approvals', '/tasks', '/family'].includes(path) && (economy || path === '/settings' || (path === '/approvals' && waiting)) ? path : '/'} economy={economy} waiting={waiting} />
        )}
        <Sheet open={Boolean(picking)} onClose={() => setPicking(null)} title="Choose a child" returnFocus={picking}>
          <div className="opts" role="radiogroup" aria-label="Choose a child" onKeyDown={radioKeys}>
            {(kids ?? []).map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                className="opt"
                aria-checked={k.id === childId}
                onClick={() => {
                  setPicking(null);
                  pick(k.id);
                }}
              >
                <span className="radio" aria-hidden="true" />
                <span className="opt-text">
                  <span className="opt-label">{k.name}</span>
                </span>
              </button>
            ))}
          </div>
        </Sheet>
      </HelpProvider>
    </ToastProvider>
  );
}

/** The teal band while the first answer is on its way, so the screen does not flash white. */
function Waiting({ error, onRetry }: { error?: string | undefined; onRetry?: () => void }) {
  return (
    <main className="screen">
      <div className="shell">
        <div className="shell-inner" style={{ minHeight: 120 }} />
      </div>
      <div className="sec">
        <Notice>{error}</Notice>
        {error && onRetry ? (
          <button type="button" className="btn btn-quiet" style={{ width: '100%', marginTop: 12 }} onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </main>
  );
}
