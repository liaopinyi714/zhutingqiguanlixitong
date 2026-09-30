import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export function useDebounced<T>(value: T, delay = 180) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
export type Page<T> = { items: T[]; nextCursor: string | null };
// One current page plus cursor history, not an ever-growing array of records.
export function useReadResource<T>(path: string | null, scope: string) {
  const key = path ? scope + ':' + path : '';
  const liveKey = useRef(key);
  liveKey.current = key;
  const sequence = useRef(0);
  const [state, setState] = useState<{
    key: string;
    data?: T;
    loading: boolean;
    error: string;
    status?: number;
    cursor: string | null;
    history: (string | null)[];
  }>({ key: '', loading: false, error: '', cursor: null, history: [] });
  async function load(cursor: string | null = null, history: (string | null)[] = []) {
    if (!path || liveKey.current !== key) return;
    const version = ++sequence.current;
    setState((previous) => ({
      ...previous,
      key,
      loading: true,
      error: '',
      status: undefined,
      cursor,
      history,
    }));
    try {
      const data = (await api(path + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))) as T;
      if (liveKey.current === key && version === sequence.current)
        setState({ key, data, loading: false, error: '', cursor, history });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined;
      if (liveKey.current === key && version === sequence.current)
        setState((previous) => ({
          ...previous,
          data: status && [401, 403, 404].includes(status) ? undefined : previous.data,
          key,
          loading: false,
          error: (error as Error).message,
          status,
        }));
      throw error;
    }
  }
  useEffect(() => {
    setState({ key, loading: !!path, error: '', cursor: null, history: [] });
    if (path) void load().catch(() => {});
    return () => {
      sequence.current++;
    };
  }, [key]);
  const matches = !!key && state.key === key;
  return {
    data: matches ? state.data : undefined,
    loading: !!path && (!matches || state.loading),
    error: matches ? state.error : '',
    notFound: matches && state.status === 404,
    page: matches ? state.history.length + 1 : 1,
    hasPrevious: matches && state.history.length > 0,
    reload: () => load(),
    retry: () =>
      load(state.status === 400 ? null : state.cursor, state.status === 400 ? [] : state.history),
    next: (cursor: string) => load(cursor, [...state.history, state.cursor]),
    previous: () => load(state.history.at(-1) ?? null, state.history.slice(0, -1)),
  };
}
export function usePagedResource<T>(path: string | null, scope: string) {
  const read = useReadResource<Page<T>>(path, scope);
  return {
    ...read,
    items: read.data?.items || [],
    hasNext: !!read.data?.nextCursor,
    next: () => (read.data?.nextCursor ? read.next(read.data.nextCursor) : Promise.resolve()),
  };
}
