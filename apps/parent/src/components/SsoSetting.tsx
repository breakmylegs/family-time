// Settings, for the owner: link an account at the household's sign-in service, such as Authelia or
// Authentik, for signing in (brief Part 8). Shown only when the server has it set up. Passkeys keep
// working either way.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { ssoWords } from '../screens/SignIn';

type State = { available: boolean; linked: boolean; name: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What came back from linking, from the `sso` the api puts on the address. */
function backWords(name: string): Record<string, string> {
  const failed = ssoWords(name);
  return {
    linked: `Linked. You can sign in with ${name} from now on.`,
    taken: `That ${name} account is already linked to someone else here.`,
    failed: `${cap(name)} didn't confirm who you are, so nothing was linked. Try again.`,
    stale: failed.stale!,
    unreachable: `Family time couldn't reach ${name}, so nothing was linked. Check it is running, then try again.`,
  };
}

export function SsoSetting() {
  const [state, setState] = useState<State>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>();
  const back = new URLSearchParams(location.search).get('sso') ?? '';

  const load = () =>
    api<State>('GET', '/api/auth/oidc')
      .then(setState)
      .catch(() => setState({ available: false, linked: false, name: 'your sign-in service' }));
  useEffect(() => {
    void load();
  }, []);
  if (!state?.available) return null;
  const name = state.name;

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
        Sign in with {name}
        <small role="status">
          {note ?? backWords(name)[back] ?? (state.linked ? 'Linked to your account. Your passkey still works too.' : `Not linked. Link it to sign in with ${name} as well as your passkey.`)}
        </small>
      </span>
      <span className="row-end">
        <button type="button" className="btn btn-quiet row-btn" disabled={busy} onClick={() => void (state.linked ? unlink() : link())}>
          {state.linked ? 'Unlink' : 'Link'}
        </button>
      </span>
    </div>
  );
}
