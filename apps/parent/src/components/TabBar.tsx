// Control and Settings only. Approvals, Tasks and Family arrive in Phase 4, when they do something.
import { Icon, type IconName } from '../icons';
import { navigate } from '../router';

const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: '/', label: 'Control', icon: 'shield' },
  { path: '/settings', label: 'Settings', icon: 'sliders' },
];

/** Keeps the child shown when switching tabs; drops a help deep link, which was for the last screen. */
function childQuery(): string {
  const child = new URLSearchParams(location.search).get('child');
  return child ? `?child=${encodeURIComponent(child)}` : '';
}

export function TabBar({ path }: { path: string }) {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <button key={t.path} type="button" className="tab" aria-current={path === t.path ? 'page' : undefined} onClick={() => navigate(t.path + childQuery())}>
          <Icon name={t.icon} />
          {t.label}
        </button>
      ))}
    </nav>
  );
}
