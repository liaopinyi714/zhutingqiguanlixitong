import { describe, it, expect } from 'vitest';
import { pta, examSchema, frequencies, canWrite } from '../server/domain';
const points = () =>
  frequencies.map((f) => ({ frequency: f, value: 40, noResponse: false, masked: false }));
describe('听力数据', () => {
  it('四频平均只取 500、1000、2000、4000 Hz', () => {
    const p = points();
    p.find((v) => v.frequency === 4000)!.value = 60;
    p[0].value = 100;
    expect(pta(p)).toBe(45);
  });
  it('缺测和无反应不能作为正常听阈参与平均', () => {
    const p: any[] = points();
    p.find((v) => v.frequency === 500)!.value = null;
    expect(pta(p)).toBeNull();
    p.find((v) => v.frequency === 500)!.value = 120;
    p.find((v) => v.frequency === 500)!.noResponse = true;
    expect(pta(p)).toBeNull();
  });
  it('拒绝重复频率和越界听阈', () => {
    const input = {
      date: '2026-09-26',
      right: points(),
      left: points(),
      boneRight: points(),
      boneLeft: points(),
      speech: '',
      other: '',
      conclusion: '测试',
    };
    expect(examSchema.safeParse(input).success).toBe(true);
    input.right[1].frequency = 125;
    expect(examSchema.safeParse(input).success).toBe(false);
    input.right = points();
    input.left[0].value = 125;
    expect(examSchema.safeParse(input).success).toBe(false);
  });
  it('只有店主拥有写入权限', () => {
    expect(canWrite('前台', 'exam')).toBe(false);
    expect(canWrite('前台', 'fitting')).toBe(false);
    expect(canWrite('前台', 'followup')).toBe(false);
    expect(canWrite('验配师', 'exam')).toBe(false);
  });
});
