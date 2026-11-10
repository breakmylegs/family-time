// Settings, for the owner: link an Authentik account for signing in (brief Part 8). Shown only
// when the server has sign-in through Authentik set up. Passkeys keep working either way.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';

const BACK_WORDS: Record<string, string> = {
  linked: 'Linked. You can sign in with Authentik from now on.',
  taken: 'That Authentik account is already linked to someone else here.',
};

export function SsoSetting() {
  const [state, setState] = useState<{ available: boolean; linked: boolean }>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>(() => BACK_WORDS[new URLSearchParams(location.search).get('sso') ?? '']);

  const load = () =>
    api<{ available: boolean; linked: boolean }>('GET', '/api/auth/oidc')
      .then(setState)
      .catch(() => setState({ available: false, linked: false }));
  useEffect(() => {
    void load();
  }, []);
  if (!state?.available) return null;

  const link = async () => {
    setBusy(true);
    setNote(undefined);
    try {
      location.assign((await api<{ url: string }>('POST', '/api/auth/oidc/link')).url);
    } catch (err) {
      setNote((err as Error).message);
      setBusy(false);
    }
  };
  const unlink = async () => {
    setBusy(true);
    try {
      await api('POST', '/api/auth/oidc/unlink');
      setNote('Unlinked. Sign in with your passkey from now on.');
      await load();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row">
      <span className="row-icon">
        <Icon name="users" />
      </span>
      <span className="row-text">
        Sign in with Authentik
        <small role="status">{note ?? (state.linked ? 'Linked to your account. Your passkey still works too.' : 'Not linked. Link it to sign in with Authentik as well as your passkey.')}</small>
      </span>
      <span className="row-end">
        <button type="button" className="btn btn-quiet row-btn" disabled={busy} onClick={() => void (state.linked ? unlink() : link())}>
          {state.linked ? 'Unlink' : 'Link'}
        </button>
      </span>
    </div>
  );
}
