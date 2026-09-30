export type ReadPlanInput = {
  page: string;
  selected: string | null;
  role: string;
  tenant: string;
  filter: string;
  search: string;
  taskFilter: string;
  searchOpen: boolean;
};

// Opening a page loads its own data, not every workspace directory.
export function workspaceReadPaths(input: ReadPlanInput) {
  const { page, selected, role, tenant, filter, search, taskFilter, searchOpen } = input;
  const active = !!role && !!tenant;
  return {
    summary:
      active && !['accounts', 'settings', 'intake', 'recycle'].includes(page)
        ? '/summary?detail=' + (page === 'reports' ? '1' : '0')
        : null,
    recent: active && (page === 'overview' || searchOpen) ? '/customers?paged=1&limit=6' : null,
    customers:
      active && page === 'customers' && !selected
        ? `/customers?paged=1&filter=${encodeURIComponent(filter)}&q=${encodeURIComponent(search)}`
        : null,
    profile: active && selected ? '/customers/' + encodeURIComponent(selected) : null,
    tasks:
      active && ['overview', 'followups'].includes(page)
        ? `/followups?paged=1&limit=${page === 'overview' ? 4 : 50}&filter=${encodeURIComponent(page === 'overview' ? '待完成' : taskFilter)}`
        : null,
    removed: active && page === 'recycle' ? '/customers/removed?paged=1' : null,
  };
}
