import { afterEach, describe, expect, it, vi } from 'vitest';
import { age, daysUntil, today, timestamp } from '../shared/calendar';
import { customerSchema } from '../server/domain';
import { blankCurve } from '../shared/hearing';

afterEach(() => vi.useRealTimers());
describe('共享业务日期', () => {
  it('北京时间凌晨与 UTC 日期边界保持一致', () => {
    expect(today(new Date('2026-09-29T16:00:00Z'))).toBe('2026-09-30');
    expect(today(new Date('2026-09-29T15:59:59Z'))).toBe('2026-09-29');
  });
  it('服务器允许北京时间的当天出生日期，拒绝明天', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T16:01:00Z'));
    const input = {
      name: '测试',
      gender: '未填写',
      birthDate: '2026-09-30',
      phone: '',
      source: '',
      status: '待评估',
    };
    expect(customerSchema.safeParse(input).success).toBe(true);
    expect(customerSchema.safeParse({ ...input, birthDate: '2026-10-01' }).success).toBe(false);
  });
  it('保修天数使用日期运算，跨月及闰年不丢天', () => {
    expect(daysUntil('2026-10-01', '2026-09-30')).toBe(1);
    expect(daysUntil('2024-03-01', '2024-02-28')).toBe(2);
    expect(daysUntil('2026-09-29', '2026-09-30')).toBe(-1);
    expect(daysUntil('2026-09-30', '2026-09-30')).toBe(0);
  });
  it('年龄按生日当天递增，空日期不参与统计', () => {
    expect(age('1960-10-01', '2026-09-30')).toBe(65);
    expect(age('1960-10-01', '2026-10-01')).toBe(66);
    expect(age('', '2026-09-30')).toBeNaN();
  });
  it('UTC 数据库时间和带时区 ISO 时间表示同一时刻', () => {
    expect(timestamp('2026-09-30 02:00:00').getTime()).toBe(
      timestamp('2026-09-30T10:00:00+08:00').getTime(),
    );
  });
  it('新检查的不同曲线互不共享可变测点', () => {
    const a = blankCurve(),
      b = blankCurve();
    a[0].masked = true;
    expect(b[0].masked).toBe(false);
    expect(a).toHaveLength(11);
  });
});
