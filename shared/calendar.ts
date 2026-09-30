export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = 30;
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Date-only business fields have no UTC offset. Keep browser and Worker dates
// consistent, including the first eight hours of a day in mainland China.
export function today(now = new Date()) {
  const parts = formatter.formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function daysUntil(date: string, reference = today()) {
  return Math.round(
    (Date.parse(date + 'T00:00:00Z') - Date.parse(reference + 'T00:00:00Z')) / DAY_MS,
  );
}

export function age(date: string, reference = today()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) return NaN;
  return (
    Number(reference.slice(0, 4)) -
    Number(date.slice(0, 4)) -
    (reference.slice(5) < date.slice(5) ? 1 : 0)
  );
}

// SQLite CURRENT_TIMESTAMP is UTC; already-qualified ISO timestamps stay intact.
export function timestamp(value: string) {
  return new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
}
