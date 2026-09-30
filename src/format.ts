import { BUSINESS_TIME_ZONE, DAY_MS, RETENTION_DAYS, timestamp } from '../shared/calendar';
export { today, age, daysUntil } from '../shared/calendar';
const currency = new Intl.NumberFormat('zh-CN');
export const money = (n: number) => currency.format(n);
export const localTime = (value: string) =>
  timestamp(value).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: BUSINESS_TIME_ZONE,
  });
export const restoreDeadline = (value: string) =>
  new Date(timestamp(value).getTime() + RETENTION_DAYS * DAY_MS).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
