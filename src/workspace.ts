import { daysUntil as warrantyDays } from '../shared/calendar';
export { warrantyDays };
export const pages = [
  'overview',
  'customers',
  'intake',
  'devices',
  'repairs',
  'followups',
  'warranties',
  'reports',
  'settings',
  'accounts',
  'recycle',
] as const;
export const customerTabs = [
  '概览',
  '听力检查',
  '验配记录',
  '维修记录',
  '随访记录',
  '报告附件',
] as const;
export type WorkspaceRoute = {
  page: string;
  customer: string | null;
  tab: string;
  record: string;
  device: string;
};
export function readRoute(hash: string): WorkspaceRoute {
  const params = new URLSearchParams(hash.replace(/^#\/?/, ''));
  const page = params.get('page') || 'overview';
  const tab = params.get('tab') || '概览';
  return {
    page: pages.includes(page as any) ? page : 'overview',
    customer: page === 'customers' ? params.get('customer') : null,
    tab: customerTabs.includes(tab as any) ? tab : '概览',
    record: params.get('record') || '',
    device: params.get('device') || '',
  };
}
export function routeHash(route: WorkspaceRoute) {
  const params = new URLSearchParams({ page: route.page });
  if (route.customer && route.page === 'customers') {
    params.set('customer', route.customer);
    if (route.tab !== '概览') params.set('tab', route.tab);
    if (route.record) params.set('record', route.record);
    if (route.device) params.set('device', route.device);
  }
  return '#' + params.toString();
}
export function deviceName(value: any) {
  return [value?.brand, value?.series, value?.model].filter(Boolean).join(' · ') || '型号待补充';
}
export function deviceSerial(value: any) {
  return (
    [
      value?.serialLeft && '左耳：' + value.serialLeft,
      value?.serialRight && '右耳：' + value.serialRight,
    ]
      .filter(Boolean)
      .join('；') ||
    value?.serial ||
    '序列号未填写'
  );
}
export function warrantyLabel(date: string) {
  if (!date) return '未填写保修';
  const days = warrantyDays(date);
  return days < 0
    ? `已到期 ${-days} 天`
    : days === 0
      ? '今天到期'
      : days <= 90
        ? `${days} 天后到期`
        : '保修中';
}
