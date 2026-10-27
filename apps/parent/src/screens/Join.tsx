import type { InviteLookup, Me } from '@family-time/schemas';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { joinWithPasskey } from '../passkeys';
import { Notice, Page, roleName, Shell } from '../ui';

/** The token is after `#` in the link, so it never reaches a server log. */
function tokenFromHash(): string {
  return decodeURIComponent(location.hash.replace(/^#/, ''));
}

export function Join({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [token] = useState(tokenFromHash);
  const [invite, setInvite] = useState<InviteLookup>();
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This link is not complete. Copy the whole link and try again.');
      return;
    }
    api<InviteLookup>('POST', '/api/invites/lookup', { token }).then(setInvite, (err: Error) => setError(err.message));
  }, [token]);

  const join = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onSignedIn(await joinWithPasskey(token, label.trim() || undefined));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!invite) {
    return (
      <Page>
        <Shell title="Family time" />
        <div className="px-4">
          <Notice>{error}</Notice>
        </div>
      </Page>
    );
  }

  const recovery = invite.kind === 'recovery';
  const title = recovery ? `Add a passkey for ${invite.displayName}` : `Hi ${invite.displayName}`;
  const line = recovery
    ? 'Use this if you have lost or replaced the phone you signed in with. Your other passkeys still work.'
    : `You have been invited to join ${invite.householdName} as ${article(roleName[invite.role] ?? invite.role)}.`;

  return (
    <Page>
      <Shell title={title} line={line} />
      <div className="px-4 pt-6">
        <p className="mx-1 text-[17px] leading-snug text-ink-2">
          A passkey lives on this phone and is unlocked with Face ID or your passcode. There is no password to remember.
        </p>
        <label className="mx-1 mt-6 block text-[15px] font-semibold" htmlFor="device-label">
          Name this phone <span className="font-normal text-ink-3">(optional)</span>
        </label>
        <input
          id="device-label"
          className="field mt-2"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="For example, Mum's iPhone"
          maxLength={60}
          autoComplete="off"
          enterKeyHint="done"
        />
        <button type="button" className="btn btn-primary mt-5 w-full" onClick={join} disabled={busy}>
          {busy ? 'Waiting for your passkey' : 'Make my passkey'}
        </button>
        <Notice>{error}</Notice>
      </div>
    </Page>
  );
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word.toLowerCase()}` : `a ${word.toLowerCase()}`;
}
