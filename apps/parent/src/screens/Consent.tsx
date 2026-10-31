// Connecting an app (Phase 7, ADR 0016): an assistant such as Claude asks to see the family's
// status, and perhaps to suggest changes. The parent reads what it asks for and says yes or no.
// The owner's yes also lets the app in for the family; other parents can only use apps already in.
import type { Me, OAuthConsent } from '@family-time/schemas';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { HelpButton } from '../help/HelpButton';
import { Icon } from '../icons';
import { Notice } from '../ui';

const SCOPE_WORDS = {
  read: "See what each child can use now, their week, today's changes and what's waiting on Approvals.",
  propose: "Suggest an Allow, Block or Pause, or a yes to a child's request. Each suggestion is a card on Approvals: nothing changes until a parent approves it.",
} as const;

export function Consent({ me }: { me: Me }) {
  const query = Object.fromEntries(new URLSearchParams(location.search));
  const [consent, setConsent] = useState<OAuthConsent>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<OAuthConsent>('GET', `/api/oauth/consent${location.search}`)
      .then(setConsent)
      .catch((err: Error) => setError(err.message));
  }, []);

  const answer = async (approve: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ redirect: string }>('POST', '/api/oauth/consent', { query, approve });
      location.assign(r.redirect);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const mustAsk = consent && !consent.allowed && !consent.canAllow;

  return (
    <main className="screen" aria-label="Connect an app">
      <div className="large">
        <h1>Connect an app</h1>
        <p>Signed in as {me.displayName}.</p>
      </div>
      <section className="sec" aria-labelledby="asks">
        {consent ? (
          <>
            <div className="sec-head">
              <h2 id="asks">{consent.client.name} would like to:</h2>
              <HelpButton topic="connected-apps" label="Connected apps" />
            </div>
            <ul className="group">
              {consent.scopes.map((s) => (
                <li key={s} className="row">
                  <span className="row-icon">
                    <Icon name={s === 'read' ? 'shield' : 'inbox'} />
                  </span>
                  <span className="row-text">{SCOPE_WORDS[s]}</span>
                </li>
              ))}
            </ul>
            <p className="list-note">
              Its details come from {consent.client.host}. It can never change a rule by itself, and you can remove it any time in Settings.
              {!consent.allowed && consent.canAllow ? ' Saying yes also lets it in for the rest of the family.' : ''}
            </p>
            {mustAsk ? <Notice>The owner needs to connect {consent.client.name} first. Ask them to do it once from their phone, then try again.</Notice> : null}
            <div className="actions">
              {mustAsk ? null : (
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void answer(true)}>
                  Yes, connect it
                </button>
              )}
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void answer(false)}>
                No thanks
              </button>
            </div>
          </>
        ) : error ? null : (
          <p className="empty">Checking the app.</p>
        )}
        <Notice>{error}</Notice>
      </section>
    </main>
  );
}
