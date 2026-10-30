import type { AuthState, Me } from '@family-time/schemas';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { TabBar } from './components/TabBar';
import { useChildren, useChildStatus } from './control/useChildStatus';
import { HelpProvider } from './help/HelpContext';
import { useLive } from './live';
import { navigate, usePath } from './router';
import { Control } from './screens/Control';
import { Home } from './screens/Home';
import { Join } from './screens/Join';
import { People } from './screens/People';
import { Settings } from './screens/Settings';
import { SignIn } from './screens/SignIn';
import { ToastProvider } from './toast';
import { Notice, Page, Shell } from './ui';

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
    setState({ setup: 'ready', me });
    // Replace, so Back does not return to a used invite link.
    navigate('/', { replace: true });
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

  if (!state.me) return <SignIn setup={state.setup} onSignedIn={signedIn} />;

  const signedOut = () => {
    setState({ setup: 'ready', me: null });
    navigate('/');
  };
  return <SignedIn me={state.me} path={path} onSignedOut={signedOut} />;
}

function SignedIn({ me, path, onSignedOut }: { me: Me; path: string; onSignedOut: () => void }) {
  const { children: kids, childId, pick, error: kidsError } = useChildren(true);
  const cs = useChildStatus(childId);
  useLive(() => void cs.refresh());
  const child = cs.status ? { name: cs.status.child.name, pronouns: cs.status.child.pronouns } : { name: 'your child', pronouns: 'they' as const };

  let screen;
  if (path === '/people' && me.capabilities.includes('people.view')) screen = <People me={me} />;
  else if (path === '/settings') screen = <Settings me={me} kids={kids ?? []} onSignedOut={onSignedOut} />;
  else if (kidsError || cs.error) screen = <Waiting error={kidsError ?? cs.error} />;
  else if (kids && !kids.length) screen = <Home me={me} onSignedOut={onSignedOut} />;
  else if (kids && cs.status)
    screen = (
      <Control
        me={me}
        kids={kids}
        status={cs.status}
        history={cs.history}
        setStatus={cs.setStatus}
        accept={cs.accept}
        setHistory={cs.setHistory}
        refresh={cs.refresh}
        onPickChild={pick}
      />
    );
  else screen = <Waiting />;

  return (
    <ToastProvider>
      <HelpProvider child={child} status={cs.status}>
        {screen}
        {path === '/people' ? null : <TabBar path={path === '/settings' ? '/settings' : '/'} />}
      </HelpProvider>
    </ToastProvider>
  );
}

/** The teal band while the first answer is on its way, so the screen does not flash white. */
function Waiting({ error }: { error?: string | undefined }) {
  return (
    <main className="screen">
      <div className="shell">
        <div className="shell-inner" style={{ minHeight: 120 }} />
      </div>
      <div className="sec">
        <Notice>{error}</Notice>
      </div>
    </main>
  );
}
