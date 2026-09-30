import type { Customer, Follow } from './types';
import { useDebounced, usePagedResource, useReadResource } from './useReadResource';
import { workspaceReadPaths, type ReadPlanInput } from './readPlan';
import { useEffect, useRef, useState } from 'react';
import { today } from '../shared/calendar';
export type Summary = {
  date: string;
  customers: number;
  fitted: number;
  status: Record<string, number>;
  pending: number;
  completed: number;
  today: number;
  overdue: number;
  devices: number;
  repairs: number;
  warrantyAlerts: number;
};
const empty: Summary = {
  date: '',
  customers: 0,
  fitted: 0,
  status: {},
  pending: 0,
  completed: 0,
  today: 0,
  overdue: 0,
  devices: 0,
  repairs: 0,
  warrantyAlerts: 0,
};
export function useWorkspaceData(input: ReadPlanInput) {
  const { page, selected, tenant } = input;
  const [businessDate, setBusinessDate] = useState(today);
  useEffect(() => {
    if (!input.role || !tenant) return;
    const update = () => {
      if (document.visibilityState === 'visible') setBusinessDate(today());
    };
    update();
    const timer = setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [input.role, tenant]);
  const q = useDebounced(input.search),
    paths = workspaceReadPaths({ ...input, search: q });
  const summary = useReadResource<Summary>(paths.summary, tenant + ':' + businessDate);
  const recent = usePagedResource<Customer>(paths.recent, tenant);
  const customerList = usePagedResource<Customer>(paths.customers, tenant);
  const customerProfile = useReadResource<Customer>(paths.profile, tenant);
  const tasks = usePagedResource<Follow>(paths.tasks, tenant + ':' + businessDate);
  const removed = usePagedResource<Customer>(paths.removed, tenant + ':' + businessDate);
  const lastSummary = useRef<{ tenant: string; data: Summary } | null>(null);
  if (!input.role || !tenant) lastSummary.current = null;
  else if (summary.data) lastSummary.current = { tenant, data: summary.data };
  const customerRead = selected ? customerProfile : page === 'overview' ? recent : customerList;
  const resources = { customers: customerRead, followups: tasks, removed, stats: summary, recent };
  const dataState = Object.fromEntries(
    Object.entries(resources).map(([key, resource]) => [
      key,
      selected && key === 'customers' && resource.notFound
        ? 'ready'
        : resource.error
          ? 'error'
          : resource.loading || !resource.data
            ? 'loading'
            : 'ready',
    ]),
  ) as Record<keyof typeof resources, 'loading' | 'ready' | 'error'>;
  return {
    customer: customerProfile.data,
    customers: page === 'overview' ? recent.items : customerList.items,
    followups: tasks.items,
    removedCustomers: removed.items,
    stats:
      summary.data || (lastSummary.current?.tenant === tenant ? lastSummary.current.data : empty),
    recent,
    customerList,
    tasks,
    removed,
    dataState,
    loadDataset: (key: keyof typeof resources) => resources[key].reload(),
    refresh: (skipProfile = false) =>
      Promise.all(
        [
          ...new Set(
            Object.entries(resources)
              .filter(([key]) => !(skipProfile && selected && key === 'customers'))
              .map(([, resource]) => resource),
          ),
        ].map((resource) => resource.reload()),
      ),
  };
}
