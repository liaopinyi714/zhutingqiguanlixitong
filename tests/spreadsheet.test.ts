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
  it('核心表一位客户一行，包含稳定编号、本人和亲属联系方式以及左右耳历史设备', () => {
    const [core] = makeSheets(snapshot, 'core');
    expect(core.rows).toHaveLength(1);
    expect(core.rows[0][4]).toBe('001234');
    expect(core.rows[0][6]).toBe('0005566');
    expect(core.rows[0][11]).toBe('stable-customer-id');
    expect(core.rows[0][10]).toContain('2024-01-01  旧品牌 · 旧型号  左耳：000L');
    expect(core.rows[0][10]).toContain('左耳：111L；右耳：222R');
  });
  it('扩展表保留同一核心表，其他每张表带客户姓名和稳定编号，听力只取整理后的数值', () => {
    const [core, hearing, devices, repairs, followups] = makeSheets(snapshot, 'extended');
    expect(core).toEqual(makeSheets(snapshot, 'core')[0]);
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
    expect(book).toContain('客户核心信息');
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
