// The economy's data for the screens, refreshed whenever the server says something changed.
import type { ApprovalItem, LedgerLine, Task, WeekSummary } from '@family-time/schemas';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';

/** Bumped on every live change, so every screen fetches again without its own stream. */
export const LiveVersion = createContext(0);

export interface Pilot {
  phase: string;
  features: { economy: boolean; bonus: boolean; goal: boolean; taper: boolean };
}

/** Fetches `path` now and on every live change. `undefined` until the first answer. */
export function useFetched<T>(path: string | undefined) {
  const version = useContext(LiveVersion);
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>('GET', path));
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load, version]);
  return { data, setData, error, reload: load };
}

export const usePilot = () => useFetched<Pilot>('/api/household/pilot');
export const useWeek = (childId: string | undefined) => useFetched<WeekSummary>(childId ? `/api/children/${childId}/week` : undefined);
export const useApprovals = (enabled: boolean) => useFetched<ApprovalItem[]>(enabled ? '/api/approvals' : undefined);
export const useWaiting = (enabled: boolean) => useFetched<{ waiting: number }>(enabled ? '/api/approvals/count' : undefined);
export const useTasks = () => useFetched<Task[]>('/api/tasks');
export const useLedger = (childId: string | undefined) => useFetched<LedgerLine[]>(childId ? `/api/children/${childId}/ledger` : undefined);

/** "50p", "£1.20". */
export function pence(p: number): string {
  const a = Math.abs(p);
  const s = a < 100 ? `${a}p` : `£${(a / 100).toFixed(a % 100 ? 2 : 0)}`;
  return p < 0 ? `-${s}` : s;
}

/** "30 min", "1 h", "5 h 30". */
export function minutes(m: number): string {
  const a = Math.abs(m);
  const h = Math.floor(a / 60);
  const r = a % 60;
  // "63 min", not "1 h 3": under two hours, anything but whole half-hours reads as minutes.
  const s = !h || (a < 120 && a % 30) ? `${a} min` : `${h} h${r ? ` ${r}` : ''}`;
  return m < 0 ? `-${s}` : s;
}
