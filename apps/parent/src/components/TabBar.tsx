// Control and Settings always; Approvals, Jobs and Family once the pilot switches the economy on.
import { useState } from 'react';
import { Icon, type IconName } from '../icons';
import { navigate } from '../router';

const ALL: { path: string; label: string; icon: IconName; economy?: boolean }[] = [
  { path: '/', label: 'Control', icon: 'shield' },
  { path: '/approvals', label: 'Approvals', icon: 'inbox', economy: true },
  { path: '/tasks', label: 'Jobs', icon: 'list', economy: true },
  { path: '/family', label: 'Family', icon: 'users', economy: true },
  { path: '/settings', label: 'Settings', icon: 'sliders' },
];

/** Keeps the child shown when switching tabs; drops a help deep link, which was for the last screen. */
function childQuery(): string {
  const child = new URLSearchParams(location.search).get('child');
  return child ? `?child=${encodeURIComponent(child)}` : '';
}

/** `waiting` is undefined until the first answer: no badge at all until then. */
export function TabBar({ path, economy, waiting }: { path: string; economy: boolean; waiting: number | undefined }) {
  const tabs = ALL.filter((t) => economy || !t.economy);
  // The last number above zero, so the badge keeps it while it fades out.
  const [last, setLast] = useState(0);
  if (waiting && waiting !== last) setLast(waiting);
  return (
    <nav className="tabbar" aria-label="Main" data-tabs={tabs.length}>
      {tabs.map((t) => (
        <button
          key={t.path}
          type="button"
          className="tab"
          aria-current={path === t.path ? 'page' : undefined}
          aria-label={t.path === '/approvals' && waiting ? `Approvals, ${waiting} waiting` : undefined}
          onClick={() => navigate(t.path + childQuery())}
        >
          <Icon name={t.icon} />
          {t.label}
          {t.path === '/approvals' && waiting !== undefined ? (
            <span className="badge tnum" data-zero={!waiting} aria-hidden="true">
              {waiting || last || ''}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
