import type { Me } from '@family-time/schemas';
import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { Group, Notice, Page, roleName, Section, Shell } from '../ui';

export function Home({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [error, setError] = useState<string>();

  const signOut = async () => {
    try {
      await api('POST', '/api/auth/logout');
      onSignedOut();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Page>
      <Shell title={`Hi ${me.displayName}`} line={`${me.householdName}. You are signed in as ${roleName[me.role]?.toLowerCase() ?? me.role}.`} />
      <Section title="Family">
        <Group>
          {me.capabilities.includes('people.view') ? (
            <button type="button" className="flex min-h-[54px] w-full items-center justify-between px-4 text-left text-[17px] active:bg-surface-2" onClick={() => navigate('/people')}>
              <span>People</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-ink-3" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          ) : null}
        </Group>
      </Section>
      <div className="px-4 pt-8">
        <button type="button" className="btn btn-quiet w-full" onClick={signOut}>
          Sign out
        </button>
        <Notice>{error}</Notice>
      </div>
    </Page>
  );
}
