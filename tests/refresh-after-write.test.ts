import { describe, expect, it, vi } from 'vitest';
import { refreshAfterWrite } from '../src/refreshAfterWrite';

describe('已确认写入后的读取', () => {
  it('返回已加载的数据，不产生错误提示', async () => {
    const report = vi.fn();
    expect(await refreshAfterWrite(async () => ({ id: 'confirmed' }), report)).toEqual({
      id: 'confirmed',
    });
    expect(report).not.toHaveBeenCalled();
  });
  it('刷新失败不抛出保存失败，也不重发写请求', async () => {
    const write = vi.fn(async () => ({ id: 'saved' }));
    const closeEditor = vi.fn();
    const report = vi.fn();
    await write();
    closeEditor();
    await expect(
      refreshAfterWrite(async () => {
        throw new Error('network error');
      }, report),
    ).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
    expect(closeEditor).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('操作已保存'));
  });
});
