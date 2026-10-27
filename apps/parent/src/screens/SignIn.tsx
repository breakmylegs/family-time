import type { AuthState, Me } from '@family-time/schemas';
import { useState } from 'react';
import { signInWithPasskey } from '../passkeys';
import { Notice, Page, Shell } from '../ui';

export function SignIn({ setup, onSignedIn }: { setup: AuthState['setup']; onSignedIn: (me: Me) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (setup === 'needs-owner') {
    return (
      <Page>
        <Shell title="Family time" line="Not set up yet." />
        <div className="px-5 pt-6 text-[17px] leading-snug text-ink-2">
          <p>The owner sets it up from the server. They run this, then open the link it prints:</p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-surface p-3 text-[14px] text-ink">./scripts/ft.sh owner-invite --origin {location.origin}</pre>
        </div>
      </Page>
    );
  }

  const signIn = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onSignedIn(await signInWithPasskey());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <Shell title="Family time" line="Sign in with your passkey. Face ID or your passcode unlocks it." />
      <div className="px-4 pt-6">
        <button type="button" className="btn btn-primary w-full" onClick={signIn} disabled={busy}>
          {busy ? 'Waiting for your passkey' : 'Sign in'}
        </button>
        <Notice>{error}</Notice>
        <p className="mx-1 mt-6 text-[15px] leading-snug text-ink-3">New here? Open the invite link you were sent, on the phone you want to use.</p>
      </div>
    </Page>
  );
}
