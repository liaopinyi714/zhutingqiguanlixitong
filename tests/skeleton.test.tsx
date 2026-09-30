import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../src/App';
import { CustomerDetailSkeleton } from '../src/WorkspaceSkeletons';
import { HearingEditor } from '../src/HearingEditor';
import { frequencies } from '../server/domain';

afterEach(() => vi.unstubAllGlobals());

describe('页面骨架对应实际页面', () => {
  it.each([
    ['overview', '查找客户，开始服务'],
    ['customers', '客户档案'],
    ['devices', '验配设备'],
    ['repairs', '设备维修'],
    ['warranties', '保修提醒'],
    ['followups', '随访与预约'],
    ['reports', '客户与服务统计'],
    ['settings', '门店设置'],
    ['accounts', '账户管理'],
    ['recycle', '回收站'],
    ['intake', '新建客户档案'],
  ])('刷新 %s 保留本页结构和标题', (page, title) => {
    vi.stubGlobal('window', {
      location: { hash: '#page=' + page },
      localStorage: { getItem: () => null },
    });
    const html = renderToStaticMarkup(<App />);
    expect([...html.matchAll(/<h1>([^<]+)<\/h1>/g)].map((match) => match[1])).toContain(title);
    expect(html).not.toContain('boot-demo-pill');
    if (page === 'reports')
      for (const heading of ['客户来源', '客户年龄分布', '服务阶段', '随访服务类型'])
        expect(html).toContain(`<h2>${heading}</h2>`);
    if (page === 'intake')
      for (const heading of ['听力检查与听力图', '验配信息'])
        expect(html).toContain(`<h2>${heading}</h2>`);
  });
  it.each([
    ['概览', ['基本资料', '最近听力检查', '验配设备', '档案动态']],
    ['听力检查', ['听力检查']],
    ['验配记录', ['历次验配与调试']],
    ['维修记录', ['助听器维修记录']],
    ['随访记录', ['随访与服务记录']],
    ['报告附件', ['原始报告与附件']],
  ])('客户的 %s 骨架保留正确的业务结构', (tab, headings) => {
    const html = renderToStaticMarkup(<CustomerDetailSkeleton tab={tab as string} />);
    const actualHeadings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]);
    expect(actualHeadings).toEqual(headings);
    if (tab === '概览')
      for (const field of ['客户姓名', '其他联系人电话', '住址', '聆听需求与期望'])
        expect(html).toContain(field);
    if (tab === '验配记录' || tab === '维修记录') expect(html).toContain('record-card');
    if (tab === '随访记录') expect(html).toContain('task-row');
    if (tab === '报告附件') expect(html).toContain('attachment-item');
  });
  it('听力检查复用实际编辑器布局，骨架保留两张图、六个频率和标记工具', () => {
    const curve = () =>
      frequencies.map((frequency) => ({
        frequency,
        value: null,
        masked: false,
        noResponse: false,
      }));
    const value = {
      date: '2026-09-30',
      right: curve(),
      left: curve(),
      boneRight: curve(),
      boneLeft: curve(),
      speech: '',
      other: '',
      conclusion: '',
    };
    const loading = renderToStaticMarkup(<HearingEditor value={value} loading />);
    const ready = renderToStaticMarkup(<HearingEditor value={value} onChange={() => {}} />);
    for (const html of [loading, ready]) {
      expect((html.match(/class="hearing-ear"/g) || []).length).toBe(2);
      for (const label of [
        'AC',
        'BC',
        'UCL',
        '擦除',
        '撤销',
        '掩蔽',
        '无反应',
        '其他检查结果与建议',
      ])
        expect(html).toContain(label);
      for (const frequency of [250, 500, 1000, 2000, 4000, 8000])
        expect(html).toContain(`>${frequency}</text>`);
    }
    expect(loading).toContain('skeleton-hearing-value');
    expect(ready).not.toContain('skeleton-hearing-value');
  });
});
