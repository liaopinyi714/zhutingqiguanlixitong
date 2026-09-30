import { pta, editableFrequencies as frequencies } from '../shared/hearing';

export type Cell = string | number | null;
export type Sheet = {
  name: string;
  headers: string[];
  rows: Cell[][];
  widths: number[];
  wrapColumns?: number[];
};
export type Snapshot = {
  exportedAt: string;
  customers: any[];
  exams: any[];
  fittings: any[];
  repairs: any[];
  followups: any[];
};

const blank = (value: unknown): string => (value == null ? '' : String(value));
const json = (value: string) => JSON.parse(value || '{}');
function model(device: any): string {
  return [device.brand, device.series, device.model].filter(Boolean).join(' · ') || '型号未填写';
}
function serials(device: any) {
  const side = device.side || '双耳';
  const old = blank(device.serial);
  const left = blank(device.serialLeft || (side === '左耳' ? old : ''));
  const right = blank(device.serialRight || (side === '右耳' ? old : ''));
  if (side === '双耳' && !left && !right && old) return old;
  return [
    side !== '右耳' && `左耳：${left || '未填写'}`,
    side !== '左耳' && `右耳：${right || '未填写'}`,
  ]
    .filter(Boolean)
    .join('；');
}
function threshold(curve: any[], frequency: number): Cell {
  const point = curve?.find((p: any) => p.frequency === frequency);
  return point?.noResponse ? '无反应' : (point?.value ?? null);
}
function average(curve: any[]): Cell {
  return Array.isArray(curve) ? pta(curve) : null;
}
export function makeSheets(data: Snapshot, kind: 'core' | 'extended'): Sheet[] {
  const customers = data.customers;
  const customerIndex = new Map<string, any>(customers.map((c) => [c.id, c]));
  const byCustomer = (id: string) => customerIndex.get(id);
  const fittings = data.fittings.map((row) => ({ ...json(row.data), ...row }));
  const fittingIndex = new Map(fittings.map((f) => [f.id, f]));
  const fittingGroups = new Map<string, typeof fittings>();
  for (const fitting of fittings)
    fittingGroups.set(fitting.customer_id, [
      ...(fittingGroups.get(fitting.customer_id) || []),
      fitting,
    ]);
  const coreHeaders = [
    '客户姓名',
    '性别',
    '出生日期',
    '本人电话',
    '其他联系人',
    '其他联系人电话',
    '住址',
    '服务阶段',
    '客户来源',
    '历次验配设备（日期、型号、左右耳序列号）',
    '档案编号',
  ];
  const coreRows = (list: any[]): Cell[][] =>
    list.map((c) => [
      c.name,
      c.gender,
      c.birth_date,
      c.phone,
      c.contact,
      c.contact_phone,
      c.address,
      c.status,
      c.source,
      (fittingGroups.get(c.id) || [])
        .map((f) => `${f.date}  ${model(f)}  ${serials(f)}`)
        .join('\n'),
      c.id,
    ]);
  const coreSheets: Sheet[] = [
    {
      name: '已验配客户',
      headers: coreHeaders,
      rows: coreRows(customers.filter((c) => fittingGroups.has(c.id))),
      widths: [18, 9, 15, 20, 18, 22, 38, 14, 18, 75, 38],
      wrapColumns: [10],
    },
    {
      name: '未验配客户',
      headers: coreHeaders,
      rows: coreRows(customers.filter((c) => !fittingGroups.has(c.id))),
      widths: [18, 9, 15, 20, 18, 22, 38, 14, 18, 75, 38],
      wrapColumns: [10],
    },
  ];
  if (kind === 'core') return coreSheets;
  const latest = data.exams.map((row) => ({ ...json(row.data), ...row }));
  const hearingSheet: Sheet = {
    name: '最新听力',
    headers: [
      '客户姓名',
      '档案编号',
      '检查日期',
      '右耳平均听阈 dB HL',
      '左耳平均听阈 dB HL',
      ...frequencies.map((f) => `右耳 ${f} Hz`),
      ...frequencies.map((f) => `左耳 ${f} Hz`),
      '言语测试',
      '检查结论',
    ],
    rows: latest.map((e) => [
      byCustomer(e.customer_id)?.name || '',
      e.customer_id,
      e.date,
      average(e.right),
      average(e.left),
      ...frequencies.map((f) => threshold(e.right, f)),
      ...frequencies.map((f) => threshold(e.left, f)),
      e.speech,
      e.conclusion,
    ]),
    widths: [18, 38, 15, 22, 22, ...Array(12).fill(17), 36, 48],
    wrapColumns: [18, 19],
  };
  const fittingSheet: Sheet = {
    name: '验配设备',
    headers: [
      '客户姓名',
      '档案编号',
      '验配日期',
      '品牌',
      '系列',
      '型号',
      '佩戴侧',
      '左耳序列号',
      '右耳序列号',
      '旧记录序列号',
      '验配金额',
      '保修到期',
      '设备编号',
    ],
    rows: fittings.map((f) => [
      byCustomer(f.customer_id)?.name || '',
      f.customer_id,
      f.date,
      f.brand,
      f.series,
      f.model,
      f.side,
      f.serialLeft || (f.side === '左耳' ? f.serial : ''),
      f.serialRight || (f.side === '右耳' ? f.serial : ''),
      !f.serialLeft && !f.serialRight && f.side === '双耳' ? f.serial : '',
      typeof f.amount === 'number' ? f.amount : null,
      f.warranty,
      f.id,
    ]),
    widths: [18, 38, 15, 19, 20, 23, 11, 24, 24, 28, 15, 16, 38],
  };
  const repairSheet: Sheet = {
    name: '维修记录',
    headers: [
      '客户姓名',
      '档案编号',
      '设备型号',
      '设备左右耳序列号',
      '报修日期',
      '接收日期',
      '完成日期',
      '状态',
      '故障问题',
      '维修处理',
      '更换零件',
      '费用',
      '保修内',
      '设备编号',
    ],
    rows: data.repairs.map((r) => [
      byCustomer(r.customer_id)?.name || '',
      r.customer_id,
      fittingIndex.has(r.fitting_id) ? model(fittingIndex.get(r.fitting_id)) : '',
      fittingIndex.has(r.fitting_id) ? serials(fittingIndex.get(r.fitting_id)) : '',
      r.occurred_date,
      r.received_date,
      r.completed_date,
      r.status,
      r.problem,
      r.work_done,
      r.parts,
      typeof r.price === 'number' ? r.price : null,
      r.warranty_covered ? '是' : '否',
      r.fitting_id,
    ]),
    widths: [18, 38, 25, 32, 15, 15, 15, 14, 35, 35, 25, 14, 11, 38],
    wrapColumns: [4, 9, 10, 11],
  };
  const followupSheet: Sheet = {
    name: '随访记录',
    headers: ['客户姓名', '档案编号', '计划日期', '类型', '状态', '完成时间', '结果'],
    rows: data.followups.map((f) => [
      byCustomer(f.customer_id)?.name || '',
      f.customer_id,
      f.due,
      f.type,
      f.completed ? '已完成' : '待完成',
      f.completed_at,
      f.result,
    ]),
    widths: [18, 38, 15, 18, 14, 22, 48],
    wrapColumns: [7],
  };
  return [...coreSheets, hearingSheet, fittingSheet, repairSheet, followupSheet];
}
