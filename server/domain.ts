import { z } from 'zod';
const dateSchema = z.string().date();
export const customerSchema = z.object({
  name: z.string().trim().min(1).max(40),
  gender: z.enum(['男', '女', '未填写']),
  birthDate: z.union([
    dateSchema.refine(
      (value) => value >= '1900-01-01' && value <= new Date().toISOString().slice(0, 10),
    ),
    z.literal(''),
  ]),
  phone: z.string().trim().max(30),
  contact: z.string().max(100).default(''),
  contactPhone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(300).default(''),
  source: z.string().max(40),
  status: z.enum(['待评估', '试戴中', '已验配', '长期随访']),
  history: z.string().max(4000).default(''),
  needs: z.string().max(4000).default(''),
});
export const frequencies = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
export const pointSchema = z
  .object({
    frequency: z.number().refine((n) => frequencies.includes(n)),
    value: z.number().min(-10).max(120).nullable(),
    noResponse: z.boolean().default(false),
    masked: z.boolean().default(false),
  })
  .refine((p) => !p.noResponse || p.value !== null);
const curve = z
  .array(pointSchema)
  .length(11)
  .refine((p) => new Set(p.map((x) => x.frequency)).size === 11);
export const examSchema = z.object({
  date: dateSchema,
  right: curve,
  left: curve,
  boneRight: curve,
  boneLeft: curve,
  uclRight: curve.optional(),
  uclLeft: curve.optional(),
  speech: z.string().max(2000),
  other: z.string().max(3000),
  conclusion: z.string().trim().max(3000),
});
export const fittingSchema = z
  .object({
    date: dateSchema,
    brand: z.string().trim().max(50).default(''),
    series: z.string().max(80).optional(),
    model: z.string().trim().max(80),
    side: z.enum(['双耳', '左耳', '右耳']),
    serialLeft: z.string().trim().max(100).default(''),
    serialRight: z.string().trim().max(100).default(''),
    amount: z.number().min(0).max(10000000),
    warranty: z.union([dateSchema, z.literal('')]),
    notes: z.string().trim().max(4000),
  })
  .refine(
    (d) =>
      !d.serialLeft || !d.serialRight || d.serialLeft.toLowerCase() !== d.serialRight.toLowerCase(),
    {
      message: '左右耳序列号不能相同',
    },
  )
  .transform((d) => {
    const serialLeft = d.side === '右耳' ? '' : d.serialLeft;
    const serialRight = d.side === '左耳' ? '' : d.serialRight;
    return {
      ...d,
      serialLeft,
      serialRight,
      serial: [serialLeft && `左耳：${serialLeft}`, serialRight && `右耳：${serialRight}`]
        .filter(Boolean)
        .join('；'),
    };
  });
export const followupSchema = z.object({
  due: dateSchema,
  type: z.enum(['适应回访', '听力复查', '清洁保养', '维修跟进', '到店预约']),
  note: z.string().trim().max(3000),
});
export const repairSchema = z
  .object({
    fittingId: z.string().min(1),
    occurredDate: dateSchema,
    receivedDate: z.union([dateSchema, z.literal('')]),
    completedDate: z.union([dateSchema, z.literal('')]),
    status: z.enum(['待送修', '维修中', '已完成', '无法修复']),
    problem: z.string().trim().max(3000),
    findings: z.string().trim().max(3000),
    workDone: z.string().trim().max(3000),
    parts: z.string().trim().max(2000),
    price: z.number().min(0).max(10000000),
    warrantyCovered: z.boolean(),
    notes: z.string().trim().max(3000),
  })
  .refine((r) => !r.receivedDate || r.receivedDate >= r.occurredDate)
  .refine((r) => !r.completedDate || r.completedDate >= (r.receivedDate || r.occurredDate));
export function pta(points: { frequency: number; value: number | null; noResponse?: boolean }[]) {
  const selected = [500, 1000, 2000, 4000].map((f) => points.find((p) => p.frequency === f));
  return selected.some((p) => !p || p.value === null || p.noResponse)
    ? null
    : Math.round((selected.reduce((n, p) => n + p!.value!, 0) / 4) * 10) / 10;
}
export function canWrite(role: string, _resource: string) {
  return role === '店主';
}
