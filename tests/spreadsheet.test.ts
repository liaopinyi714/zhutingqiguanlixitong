import { describe, expect, it } from 'vitest';
import { makeSheets, type Snapshot } from '../src/spreadsheetExport';
import { buildXlsx } from '../src/xlsx';

const curve = (value: number) =>
  [250, 500, 1000, 2000, 4000, 8000].map((frequency) => ({ frequency, value, noResponse: false }));
const snapshot: Snapshot = {
  exportedAt: '2026-09-28T12:00:00.000Z',
  customers: [
    {
      id: 'stable-customer-id',
      name: '=测试客户',
      gender: '女',
      birth_date: '1960-01-01',
      phone: '001234',
      contact: '女儿',
      contact_phone: '0005566',
      address: '示例街道',
      status: '已验配',
      source: '转介绍',
    },
    {
      id: 'customer-without-device',
      name: '尚未验配客户',
      gender: '男',
      birth_date: '',
      phone: '000888',
      contact: '儿子',
      contact_phone: '000999',
      address: '另一处地址',
      status: '待评估',
      source: '自然到店',
    },
  ],
  exams: [
    {
      id: 'e1',
      customer_id: 'stable-customer-id',
      date: '2026-09-27',
      data: JSON.stringify({
        right: curve(40),
        left: curve(50),
        speech: '',
        conclusion: '轻中度听损',
        other: '这段备注不应导出',
      }),
    },
  ],
  fittings: [
    {
      id: 'old-device-id',
      customer_id: 'stable-customer-id',
      date: '2024-01-01',
      data: JSON.stringify({
        brand: '旧品牌',
        model: '旧型号',
        side: '左耳',
        serialLeft: '000L',
        amount: 1200,
        warranty: '2026-01-01',
        notes: '不重要备注',
      }),
    },
    {
      id: 'new-device-id',
      customer_id: 'stable-customer-id',
      date: '2026-01-01',
      data: JSON.stringify({
        brand: '新品牌',
        model: '新型号',
        side: '双耳',
        serialLeft: '111L',
        serialRight: '222R',
        amount: 3500,
        warranty: '2028-01-01',
      }),
    },
  ],
  repairs: [
    {
      id: 'repair-1',
      customer_id: 'stable-customer-id',
      fitting_id: 'old-device-id',
      occurred_date: '2026-09-01',
      received_date: '2026-09-02',
      completed_date: '',
      status: '维修中',
      problem: '受话器无声',
      work_done: '检测',
      parts: '受话器',
      price: 200,
      warranty_covered: 0,
    },
  ],
  followups: [
    {
      id: 'follow-1',
      customer_id: 'stable-customer-id',
      due: '2026-10-01',
      type: '适应回访',
      completed: 0,
      completed_at: '',
      result: '',
    },
  ],
};

function zipEntry(bytes: Uint8Array, path: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    if (name === path) return new TextDecoder().decode(bytes.subarray(start, start + size));
    offset = start + size;
  }
  throw new Error(`${path} missing`);
}

describe('离线 Excel 导出', () => {
  it('核心导出按有效验配记录拆为两张互不重复的客户表，删除年龄列并保留关键字段', () => {
    const [fitted, unfitted] = makeSheets(snapshot, 'core');
    expect([fitted.name, unfitted.name]).toEqual(['已验配客户', '未验配客户']);
    expect(fitted.headers).toEqual(unfitted.headers);
    expect(fitted.headers).not.toContain('年龄（导出时）');
    expect(fitted.rows).toHaveLength(1);
    expect(unfitted.rows).toHaveLength(1);
    expect(fitted.rows[0][3]).toBe('001234');
    expect(fitted.rows[0][5]).toBe('0005566');
    expect(fitted.rows[0][10]).toBe('stable-customer-id');
    expect(fitted.rows[0][9]).toContain('2024-01-01  旧品牌 · 旧型号  左耳：000L');
    expect(fitted.rows[0][9]).toContain('左耳：111L；右耳：222R');
    expect(unfitted.rows[0][0]).toBe('尚未验配客户');
    expect(unfitted.rows[0][9]).toBe('');
    expect(unfitted.rows[0][10]).toBe('customer-without-device');
    const emptyFittings = makeSheets({ ...snapshot, fittings: [] }, 'core');
    expect(emptyFittings.map((sheet) => sheet.rows.length)).toEqual([0, 2]);
    expect(buildXlsx(emptyFittings)[0]).toBe(0x50);
  });
  it('业务导出完整保留两张客户表，其他每张表带姓名和编号，听力只取整理后的数值', () => {
    const [fitted, unfitted, hearing, devices, repairs, followups] = makeSheets(
      snapshot,
      'extended',
    );
    expect([fitted, unfitted]).toEqual(makeSheets(snapshot, 'core'));
    for (const sheet of [hearing, devices, repairs, followups]) {
      expect(sheet.headers.slice(0, 2)).toEqual(['客户姓名', '档案编号']);
      expect(sheet.rows[0].slice(0, 2)).toEqual(['=测试客户', 'stable-customer-id']);
    }
    expect(hearing.rows[0][3]).toBe(40);
    expect(hearing.rows[0][4]).toBe(50);
    expect(devices.rows).toHaveLength(2);
    expect(repairs.rows[0][2]).toBe('旧品牌 · 旧型号');
    expect(repairs.rows[0][13]).toBe('old-device-id');
    expect(JSON.stringify(makeSheets(snapshot, 'extended'))).not.toContain('这段备注不应导出');
    expect(JSON.stringify(makeSheets(snapshot, 'extended'))).not.toContain('不重要备注');
  });
  it('生成 Excel ZIP，表头可筛选且冻结，电话和以等号开头的姓名保持文本', () => {
    const bytes = buildXlsx(makeSheets(snapshot, 'extended'));
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const book = zipEntry(bytes, 'xl/workbook.xml');
    const first = zipEntry(bytes, 'xl/worksheets/sheet1.xml');
    expect(book).toContain('已验配客户');
    expect(book).toContain('未验配客户');
    expect(book).toContain('最新听力');
    expect(first).toContain('state="frozen"');
    expect(first).toContain('<autoFilter');
    expect(first).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">=测试客户</t></is></c>',
    );
    expect(first).toContain('001234');
    expect(first).not.toContain('<f>');
  });
});
