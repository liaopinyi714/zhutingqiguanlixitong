import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { workspaceReadPaths, type ReadPlanInput } from '../src/readPlan';
import { PageNavigation } from '../src/PageNavigation';
const base: ReadPlanInput = {
  page: 'overview',
  selected: null,
  role: '店主',
  tenant: 'store-a',
  filter: '全部客户',
  search: '',
  taskFilter: '待完成',
  searchOpen: false,
};
const paths = (patch: Partial<ReadPlanInput>) => workspaceReadPaths({ ...base, ...patch });
describe('按页面读取计划', () => {
  it('未验证身份或无门店时不请求业务数据', () => {
    for (const patch of [{ role: '' }, { tenant: '' }])
      expect(Object.values(paths(patch)).every((value) => value === null)).toBe(true);
  });
  it('首页只请求短列表和 SQL 摘要，账户、设置和建档不预读客户目录', () => {
    const home = paths({});
    expect(home.summary).toBe('/summary?detail=0');
    expect(new URLSearchParams(home.recent!.split('?')[1]).get('limit')).toBe('6');
    expect(new URLSearchParams(home.tasks!.split('?')[1]).get('limit')).toBe('4');
    expect(home.customers).toBeNull();
    expect(home.removed).toBeNull();
    for (const page of ['accounts', 'settings', 'intake'])
      expect(Object.values(paths({ page })).every((value) => value === null)).toBe(true);
  });
  it('客户详情可从任意深链接独立打开，统计和回收站不依赖完整客户列表', () => {
    const profile = paths({ page: 'customers', selected: 'c/深页' });
    expect(profile.customers).toBeNull();
    expect(profile.profile).toBe('/customers/' + encodeURIComponent('c/深页'));
    const report = paths({ page: 'reports' });
    expect(report.summary).toBe('/summary?detail=0');
    expect(
      Object.entries(report)
        .filter(([, v]) => v)
        .map(([key]) => key),
    ).toEqual(['summary']);
    const recycle = paths({ page: 'recycle' });
    expect(recycle.removed).toBe('/customers/removed?paged=1');
    expect(recycle.customers).toBeNull();
    expect(paths({ page: 'repairs' }).customers).toBeNull();
    expect(paths({ page: 'devices' }).tasks).toBeNull();
  });
  it('列表筛选与关键词交给服务端，搜索入口在任意页面按需读取最近客户', () => {
    const result = paths({ page: 'customers', filter: '长期随访', search: '姓名 & 电话' });
    const query = new URLSearchParams(result.customers!.split('?')[1]);
    expect(query.get('paged')).toBe('1');
    expect(query.get('q')).toBe('姓名 & 电话');
    expect(query.get('filter')).toBe('长期随访');
    expect(paths({ page: 'accounts', searchOpen: true }).recent).toBeTruthy();
    expect(
      new URLSearchParams(
        paths({ page: 'followups', taskFilter: '已逾期' }).tasks!.split('?')[1],
      ).get('filter'),
    ).toBe('已逾期');
  });
  it('分页控件嵌入选择表单时不会误提交，末页仍可返回', () => {
    const resource = {
      page: 3,
      hasPrevious: true,
      hasNext: false,
      loading: false,
      error: '',
      next: async () => {},
      previous: async () => {},
      retry: async () => {},
    };
    const html = renderToStaticMarkup(<PageNavigation resource={resource} />);
    expect(
      [...html.matchAll(/<button([^>]+)>/g)].every(([, attributes]) =>
        attributes.includes('type="button"'),
      ),
    ).toBe(true);
    expect(html).toContain('第 3 页');
    expect(html).toMatch(/disabled=""[^>]+aria-label="下一页"/);
  });
});
