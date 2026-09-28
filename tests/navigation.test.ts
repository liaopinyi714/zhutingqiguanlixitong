import { describe, expect, it } from 'vitest';
import { readRoute, routeHash } from '../src/workspace';

describe('关联记录地址', () => {
  it('刷新后保留客户、页签、具体记录和设备筛选，包括特殊字符', () => {
    const route = {
      page: 'customers',
      customer: 'c&1',
      tab: '维修记录',
      record: 'r/1',
      device: 'f=2',
    };
    expect(readRoute(routeHash(route))).toEqual(route);
  });
  it('全局目录地址不携带上一个客户，未知页面回到首页', () => {
    expect(
      routeHash({
        page: 'devices',
        customer: 'old',
        tab: '维修记录',
        record: 'old',
        device: 'old',
      }),
    ).toBe('#page=devices');
    expect(readRoute('#page=unknown').page).toBe('overview');
    expect(readRoute('#page=customers&tab=unknown').tab).toBe('概览');
  });
});
