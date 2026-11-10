import type { AuthState, Me } from '@family-time/schemas';
import { useState } from 'react';
import { signInWithPasskey } from '../passkeys';
import { Notice, Page, Shell } from '../ui';

/** What came back from Authentik, from the `sso` the api puts on the address. */
const SSO_WORDS: Record<string, string> = {
  failed: "Authentik didn't confirm who you are. Try again, or sign in with your passkey.",
  unknown: 'That Authentik account is not linked to an owner here. Sign in with your passkey, then link it in Settings.',
  unreachable: "Family time couldn't reach Authentik. Sign in with your passkey for now.",
  off: 'Sign-in with Authentik is switched off. Sign in with your passkey.',
};

export function SignIn({ setup, sso, onSignedIn }: { setup: AuthState['setup']; sso: boolean; onSignedIn: (me: Me) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(() => SSO_WORDS[new URLSearchParams(location.search).get('sso') ?? '']);

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
        {sso ? (
          <a className="btn btn-quiet mt-3 w-full" href="/api/auth/oidc/start">
            Sign in with Authentik
          </a>
        ) : null}
        <Notice>{error}</Notice>
        <p className="mx-1 mt-6 text-[15px] leading-snug text-ink-3">New here? Open the invite link you were sent, on the phone you want to use.</p>
      </div>
    </Page>
  );
}
