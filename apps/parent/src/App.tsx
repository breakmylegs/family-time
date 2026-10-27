import type { AuthState, Me } from '@family-time/schemas';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { navigate, usePath } from './router';
import { Home } from './screens/Home';
import { Join } from './screens/Join';
import { People } from './screens/People';
import { SignIn } from './screens/SignIn';
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
  if (path === '/people' && state.me.capabilities.includes('people.view')) return <People me={state.me} />;
  return <Home me={state.me} onSignedOut={signedOut} />;
}
