// The kiosk's icons: the same stroke set as the parent app, drawn in currentColor. No emoji.
import type { JSX } from 'preact';

const PATHS: Record<string, JSX.Element> = {
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
    </>
  ),
  cube: (
    <>
      <path d="M12 3.2l7.8 4.4v8.8L12 20.8l-7.8-4.4V7.6z" />
      <path d="M4.4 7.7L12 12l7.6-4.3M12 12v8.7" />
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
  check: <path d="M5 12.6l4.4 4.4L19 7.4" />,
  play: <path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4A.8.8 0 0 0 8 5.6z" />,
  list: (
    <>
      <path d="M9.5 6.5h10.5M9.5 12h10.5M9.5 17.5h10.5" />
      <path d="M4.6 6.5h.01M4.6 12h.01M4.6 17.5h.01" stroke-width="2.6" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  left: <path d="M14.5 6l-6 6 6 6" />,
  moon: <path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z" />,
  camera: (
    <>
      <path d="M3.8 8.7A1.7 1.7 0 0 1 5.5 7h2.4l1.6-2.2h5l1.6 2.2h2.4a1.7 1.7 0 0 1 1.7 1.7v8.6a1.7 1.7 0 0 1-1.7 1.7h-13a1.7 1.7 0 0 1-1.7-1.7z" />
      <circle cx="12" cy="12.9" r="3.3" />
    </>
  ),
  hand: <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V5a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.6a6 6 0 0 1-4.4-1.9L4 15.3a1.5 1.5 0 0 1 2.2-2L8 15" />,
  eye: (
    <>
      <path d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  star: <path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.6l-5.1 2.6 1-5.6-4.1-4 5.7-.8z" />,
  dishes: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.4" />
    </>
  ),
  bed: (
    <>
      <path d="M3.5 18.5v-11M3.5 14.5h17v4" />
      <path d="M7 14.5v-2.6a1.6 1.6 0 0 1 1.6-1.6h3.2v4.2" />
      <path d="M11.8 10.3h6.6a2.1 2.1 0 0 1 2.1 2.1v2.1" />
    </>
  ),
  bin: (
    <>
      <path d="M5 7h14M9.5 7V4.8h5V7" />
      <path d="M6.5 7l1 12.2h9L17.5 7" />
    </>
  ),
  plant: (
    <>
      <path d="M12 20.5v-9" />
      <path d="M12 13.5c0-3.4-2.6-5.6-6.2-5.6 0 3.4 2.6 5.6 6.2 5.6zM12 11.5c0-3.4 2.6-5.6 6.2-5.6 0 3.4-2.6 5.6-6.2 5.6z" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.8c-2-1.6-4.7-2-7.5-1.6v12.4c2.8-.4 5.5 0 7.5 1.6 2-1.6 4.7-2 7.5-1.6V5.2c-2.8-.4-5.5 0-7.5 1.6z" />
      <path d="M12 6.8v12.4" />
    </>
  ),
  bike: (
    <>
      <circle cx="6.2" cy="15.8" r="3.4" />
      <circle cx="17.8" cy="15.8" r="3.4" />
      <path d="M6.2 15.8l3.6-7h5.4l2.6 7M9.8 8.8l2.8 7h-6.4M13.6 6.2h2.6" />
    </>
  ),
  lego: (
    <>
      <rect x="3.5" y="9" width="17" height="10" rx="1.6" />
      <path d="M7 9V6.8h3.4V9M13.6 9V6.8H17V9" />
    </>
  ),
  pencil: (
    <>
      <path d="M4.5 19.5l1-4.2L16 4.8a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z" />
      <path d="M14.5 6.3l3.2 3.2" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.6l3.6 2.6-1.4 4.2H9.8l-1.4-4.2zM12 3.4v4.2M15.6 10.2l4.1-1.3M14.2 14.4l2.5 3.5M9.8 14.4l-2.5 3.5M8.4 10.2L4.3 8.9" />
    </>
  ),
  heart: <path d="M12 19.8s-7.4-4.4-7.4-10.1A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.4 2.7c0 5.7-7.4 10.1-7.4 10.1z" />,
  tent: (
    <>
      <path d="M3 19.5L12 4.5l9 15z" />
      <path d="M12 4.5v15M9 19.5l3-5.5 3 5.5" />
    </>
  ),
};

/** The pictures a child can give an idea. */
export const IDEA_PICTURES = ['star', 'tent', 'pencil', 'ball', 'bike', 'book', 'lego', 'plant', 'heart'];

export function Icon({ name, class: className = 'ic' }: { name: string; class?: string }) {
  return (
    <svg class={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {Object.prototype.hasOwnProperty.call(PATHS, name) ? PATHS[name] : PATHS.apps}
    </svg>
  );
}
