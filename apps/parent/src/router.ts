import { useEffect, useState } from 'react';

/**
 * A very small path router. The app has a handful of screens and no nesting yet. `replace` swaps
 * the current history entry, so a link's token (after `#`) is not left in Back.
 */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const current = location.pathname + location.hash;
  if (current !== path) {
    if (options.replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
  }
  // Always tell the router, even when the address did not change, so the screen follows state.
  dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    addEventListener('popstate', update);
    return () => removeEventListener('popstate', update);
  }, []);
  return path;
}
