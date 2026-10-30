// The mock's icon set: one stroke style, 24 by 24, drawn in currentColor. No emoji as icons.
import type { ReactNode } from 'react';

const PATHS = {
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.85.85c0 1.7-2.45 2.2-2.45 3.65" />
      <path d="M12 17.1h.01" strokeWidth="2.6" />
    </>
  ),
  pause: (
    <>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" />
    </>
  ),
  play: <path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4A.8.8 0 0 0 8 5.6z" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  down: <path d="M6 9.5l6 6 6-6" />,
  right: <path d="M9.5 6l6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="3.5" />
      <path d="M10.3 9.4v5.2a.4.4 0 0 0 .6.35l4.3-2.6a.4.4 0 0 0 0-.7l-4.3-2.6a.4.4 0 0 0-.6.35z" />
    </>
  ),
  pad: (
    <>
      <path d="M7.2 8.5h9.6a4.2 4.2 0 0 1 4.2 4.2v1.6a2.6 2.6 0 0 1-4.6 1.7l-1.5-1.8H9.1l-1.5 1.8A2.6 2.6 0 0 1 3 14.3v-1.6a4.2 4.2 0 0 1 4.2-4.2z" />
      <path d="M8.3 10.9v3M6.8 12.4h3" />
      <path d="M15.6 11.6h.01M17.4 13.3h.01" strokeWidth="2.4" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3.2l7.8 4.4v8.8L12 20.8l-7.8-4.4V7.6z" />
      <path d="M4.4 7.7L12 12l7.6-4.3M12 12v8.7" />
    </>
  ),
  check: <path d="M5 12.6l4.4 4.4L19 7.4" />,
  heart: <path d="M12 19.8s-7.4-4.4-7.4-10.1A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.4 2.7c0 5.7-7.4 10.1-7.4 10.1z" />,
  shield: <path d="M12 3.2l7 2.8v5.6c0 4.3-3 7.7-7 9.3-4-1.6-7-5-7-9.3V6z" />,
  sliders: (
    <>
      <path d="M4 7.5h9.5M18.5 7.5H20M4 16.5h3M11.5 16.5H20" />
      <circle cx="16" cy="7.5" r="2.4" />
      <circle cx="9.2" cy="16.5" r="2.4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.2" r="3.4" />
      <path d="M3.2 19.4a5.8 5.8 0 0 1 11.6 0" />
      <path d="M15.4 4.9a3.4 3.4 0 0 1 0 6.6M17.2 13.9a5.8 5.8 0 0 1 3.6 5.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6.2 16.8V11a5.8 5.8 0 0 1 11.6 0v5.8l1.5 1.6H4.7z" />
      <path d="M10 20.4a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  device: (
    <>
      <rect x="5.5" y="3" width="13" height="18" rx="2.6" />
      <path d="M11 17.6h2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.6v5.2" />
      <path d="M12 16.4h.01" strokeWidth="2.6" />
    </>
  ),
  apps: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** A service's icon from the catalogue; anything unknown gets the neutral apps icon. */
export function serviceIcon(icon: string | null): IconName {
  return icon && icon in PATHS ? (icon as IconName) : 'apps';
}

export function Icon({ name, className = 'ic' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
