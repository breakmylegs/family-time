import type { Invite, Me, OpenInvite, Person } from '@family-time/schemas';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { Group, Notice, Page, roleName, Section, Shell } from '../ui';

type InviteRole = 'parent' | 'carer' | 'owner';

const ROLE_HINT: Record<InviteRole, string> = {
  parent: 'Can change rules, allow and block, and approve jobs.',
  carer: 'Can see what is on, pause everything and approve jobs. No rule changes.',
  owner: 'Everything, including people, devices and settings.',
};

export function People({ me }: { me: Me }) {
  const manage = me.capabilities.includes('people.manage');
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState<OpenInvite[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<InviteRole>('parent');
  const [made, setMade] = useState<Invite>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setPeople(await api<Person[]>('GET', '/api/people'));
      if (manage) setOpen(await api<OpenInvite[]>('GET', '/api/people/invites'));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [manage]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async () => {
    setError(undefined);
    setCopied(false);
    try {
      setMade(await api<Invite>('POST', '/api/people/invites', { displayName: name.trim(), role }));
      setName('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const share = async () => {
    if (!made) return;
    const text = `Join ${me.householdName} on Family time. Open this on your phone: ${made.link}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(made.link);
        setCopied(true);
      }
    } catch {
      // Closing the share sheet is not an error.
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Page>
      <Shell title="People" line="Everyone who can sign in to Family time.">
        <button type="button" className="btn btn-shell mt-4 h-11 px-4 text-[15px]" onClick={() => navigate('/')}>
          Back
        </button>
      </Shell>

      <Section title="Signed up">
        <Group>
          {people.map((p, i) => (
            <div key={p.id} className={`flex min-h-[60px] items-center gap-3 px-4 py-2 ${i ? 'border-t border-line' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-semibold">
                  {p.displayName}
                  {p.isMe ? <span className="font-normal text-ink-3"> (you)</span> : null}
                </div>
                <div className="text-[15px] text-ink-2">
                  {roleName[p.role]}. {p.passkeys === 1 ? '1 passkey' : `${p.passkeys} passkeys`}
                </div>
              </div>
              {manage && !p.isMe ? (
                <button
                  type="button"
                  className="btn btn-quiet h-10 px-3 text-[15px]"
                  onClick={() => {
                    if (confirm(`Remove ${p.displayName}? They will be signed out and cannot sign in again unless invited.`)) {
                      void act(() => api('DELETE', `/api/people/${p.id}`));
                    }
                  }}
                >
                  Remove {p.displayName}
                </button>
              ) : null}
            </div>
          ))}
        </Group>
      </Section>

      {manage ? (
        <Section title="Invite someone">
          <Group>
            <div className="p-4">
              <label className="block text-[15px] font-semibold" htmlFor="invite-name">
                Their name
              </label>
              <input id="invite-name" className="field mt-2" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" enterKeyHint="done" />
              <fieldset className="mt-4">
                <legend className="text-[15px] font-semibold">What they can do</legend>
                <div className="mt-2 grid grid-cols-3 gap-1 rounded-[11px] bg-surface-2 p-[3px]">
                  {(['parent', 'carer', 'owner'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={role === r}
                      className={`h-9 rounded-lg text-[15px] transition-colors ${role === r ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-ink-2'}`}
                      onClick={() => setRole(r)}
                    >
                      {roleName[r]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[15px] leading-snug text-ink-2">{ROLE_HINT[role]}</p>
              </fieldset>
              <button type="button" className="btn btn-primary mt-4 w-full" onClick={invite} disabled={!name.trim()}>
                Make an invite link for {name.trim() || 'them'}
              </button>
            </div>
          </Group>

          {made ? (
            <div className="mt-3 rounded-[18px] bg-primary-soft p-4" role="status">
              <p className="text-[15px] leading-snug text-ink">
                Send this link to {made.displayName}. It works once, for 7 days. You will not see it again.
              </p>
              <p className="mt-2 break-all text-[14px] text-ink-2" data-testid="invite-link">
                {made.link}
              </p>
              <button type="button" className="btn btn-primary mt-3 w-full" onClick={share}>
                {copied ? 'Copied' : 'Share the link'}
              </button>
            </div>
          ) : null}

          {open.length ? (
            <>
              <h3 className="mx-1 mb-2 mt-5 text-[17px] font-semibold">Waiting to join</h3>
              <Group>
                {open.map((inv, i) => (
                  <div key={inv.id} className={`flex min-h-[54px] items-center gap-3 px-4 py-2 ${i ? 'border-t border-line' : ''}`}>
                    <div className="min-w-0 flex-1 text-[15px]">
                      <span className="font-semibold">{inv.displayName}</span>, {roleName[inv.role]?.toLowerCase()}. Link works until {when(inv.expiresAt)}.
                    </div>
                    <button type="button" className="btn btn-quiet h-10 px-3 text-[15px]" onClick={() => act(() => api('DELETE', `/api/people/invites/${inv.id}`))}>
                      Cancel invite
                    </button>
                  </div>
                ))}
              </Group>
            </>
          ) : null}
        </Section>
      ) : null}

      <div className="px-4">
        <Notice>{error}</Notice>
      </div>
    </Page>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
}
