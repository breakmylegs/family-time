import type { ChildStatus, ChildSummary, HistoryEntry } from '@family-time/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

const LAST_CHILD = 'ft-child';

/** The family's children, and which one Control shows: `?child=`, then the last one picked, then the first. */
export function useChildren(enabled: boolean) {
  const [children, setChildren] = useState<ChildSummary[]>();
  const [childId, setChildId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
    api<ChildSummary[]>('GET', '/api/children')
      .then((list) => {
        setChildren(list);
        const wanted = new URLSearchParams(location.search).get('child') ?? localStorage.getItem(LAST_CHILD);
        setChildId(list.find((c) => c.id === wanted)?.id ?? list[0]?.id);
      })
      .catch((err: Error) => setError(err.message));
  }, [enabled]);

  const pick = useCallback((id: string) => {
    localStorage.setItem(LAST_CHILD, id);
    setChildId(id);
    const url = new URL(location.href);
    url.searchParams.set('child', id);
    history.replaceState(history.state, '', url.pathname + url.search);
  }, []);

  return { children, childId, pick, error };
}

/** One child's status and today's history. A newer answer always wins over an older one. */
export function useChildStatus(childId: string | undefined) {
  const [status, setStatus] = useState<ChildStatus>();
  const [historyList, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string>();
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!childId) return;
    const mine = ++seq.current;
    try {
      const [s, h] = await Promise.all([
        api<ChildStatus>('GET', `/api/children/${childId}/status`),
        api<HistoryEntry[]>('GET', `/api/children/${childId}/history`),
      ]);
      if (mine !== seq.current) return;
      setStatus(s);
      setHistory(h);
      setError(undefined);
    } catch (err) {
      if (mine === seq.current) setError((err as Error).message);
    }
  }, [childId]);

  useEffect(() => {
    setStatus(undefined);
    setHistory([]);
    void refresh();
  }, [refresh]);

  /** A server answer to an action: newer than any fetch still in flight. */
  const accept = useCallback((s: ChildStatus) => {
    seq.current++;
    setStatus(s);
  }, []);

  return { status, setStatus, accept, history: historyList, setHistory, refresh, error };
}
