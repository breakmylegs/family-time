// One help panel for the whole app. A (?) opens a topic; related topics swap in with a back link;
// `?help=topic-id` in the address opens one straight away, so a notification can link to it.
import content, { type TopicId } from '@family-time/help-content/content';
import type { ChildWords } from '@family-time/help-content';
import type { ChildStatus } from '@family-time/schemas';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { HelpPanel } from './HelpPanel';

const ICONS_KEY = 'ft-help-icons';

interface HelpApi {
  /** `from` gets focus back on close. Safari does not focus a tapped button, so it is passed in. */
  open: (topic: TopicId, from?: HTMLElement | null) => void;
  iconsOn: boolean;
  setIconsOn: (on: boolean) => void;
}

const HelpContext = createContext<HelpApi>({ open: () => undefined, iconsOn: true, setIconsOn: () => undefined });

export function useHelp() {
  return useContext(HelpContext);
}

export function isTopic(id: string | null): id is TopicId {
  return Boolean(id && Object.hasOwn(content.topics, id));
}

function dropHelpParam() {
  const url = new URL(location.href);
  if (!url.searchParams.has('help')) return;
  url.searchParams.delete('help');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

export function HelpProvider({ child, status, children }: { child: ChildWords; status: ChildStatus | undefined; children: ReactNode }) {
  const [trail, setTrail] = useState<TopicId[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [iconsOn, setIcons] = useState(() => localStorage.getItem(ICONS_KEY) !== 'off');
  const [returnTo, setReturnTo] = useState<HTMLElement | null>(null);

  const open = useCallback((topic: TopicId, from?: HTMLElement | null) => {
    setReturnTo(from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    setTrail([topic]);
    setOpen(true);
  }, []);

  // A deep link, on arrival and on Back or Forward.
  useEffect(() => {
    const fromUrl = () => {
      const id = new URLSearchParams(location.search).get('help');
      if (isTopic(id)) open(id);
    };
    fromUrl();
    addEventListener('popstate', fromUrl);
    return () => removeEventListener('popstate', fromUrl);
  }, [open]);

  const value = useMemo<HelpApi>(
    () => ({
      open,
      iconsOn,
      setIconsOn: (on) => {
        localStorage.setItem(ICONS_KEY, on ? 'on' : 'off');
        setIcons(on);
      },
    }),
    [open, iconsOn],
  );

  return (
    <HelpContext.Provider value={value}>
      {children}
      <HelpPanel
        open={isOpen}
        trail={trail}
        child={child}
        status={status}
        returnTo={returnTo}
        onFollow={(id) => setTrail((t) => [...t, id])}
        onBack={() => setTrail((t) => t.slice(0, -1))}
        onClose={() => {
          setOpen(false);
          dropHelpParam();
        }}
      />
    </HelpContext.Provider>
  );
}
