import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { measureTiming, RequestTimings } from '../server/timing';
import { installHttpBoundary } from '../server/http';
import type { AppContext } from '../server/types';

describe('临时请求耗时', () => {
  it('维护时显式启用仍可计时，无需开放公网开关或添加数据库查询', async () => {
    const app = new Hono<AppContext>();
    installHttpBoundary(app, true);
    app.get('/api/config', (c) => c.json({ demo: false }));
    const response = await app.request('/api/config', {}, { DEMO_MODE: 'false' } as any);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ demo: false });
    expect(response.headers.get('Server-Timing')).toMatch(/^worker;dur=\d+\.\d{2}$/);
  });
  it('关闭诊断时不读计时时钟或追加标头，原有边界和响应保持有效', async () => {
    const app = new Hono<AppContext>();
    installHttpBoundary(app, false);
    app.get('/api/config', (c) => c.json({ demo: true }));
    const now = vi.spyOn(performance, 'now');
    try {
      const response = await app.request('http://localhost/api/config', {}, {
        DEMO_MODE: 'true',
      } as any);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ demo: true });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Server-Timing')).toBeNull();
      expect(now).not.toHaveBeenCalled();
      const refused = await app.request(
        'http://localhost/api/config',
        {
          method: 'POST',
          headers: { Origin: 'https://untrusted.example.com' },
        },
        { DEMO_MODE: 'true' } as any,
      );
      expect(refused.status).toBe(403);
      expect(refused.headers.get('Server-Timing')).toBeNull();
    } finally {
      now.mockRestore();
    }
  });
  it('总时间包含子阶段；重复查询累加；未执行阶段不填充伪数据', async () => {
    let clock = 100;
    const timings = new RequestTimings(() => clock);
    await timings.measure('access_jwt', async () => {
      clock += 7;
    });
    await timings.measure('account_store', async () => {
      await timings.measure('me_resolve_d1', async () => {
        clock += 11;
      });
      await timings.measure('me_resolve_d1', async () => {
        clock += 13;
      });
      clock += 3;
    });
    expect(timings.header()).toBe(
      'worker;dur=34.00, access_jwt;dur=7.00, account_store;dur=27.00, me_resolve_d1;dur=24.00',
    );
  });

  it('失败阶段保留耗时并原样抛出异常，未知标签和错误内容不写入响应头', async () => {
    let clock = 0;
    const timings = new RequestTimings(() => clock);
    const error = new Error('private SQL parameter');
    await expect(
      timings.measure('summary_d1', async () => {
        clock += 17;
        throw error;
      }),
    ).rejects.toBe(error);
    await timings.measure('owner@example.com' as any, async () => {
      clock += 1;
    });
    expect(timings.header()).toBe('worker;dur=18.00, summary_d1;dur=17.00');
  });

  it('并发请求的计时独立，关闭诊断时只执行一次原操作', async () => {
    let clock = 0;
    const first = new RequestTimings(() => clock);
    clock = 5;
    const second = new RequestTimings(() => clock);
    let complete!: () => void;
    const pending = first.measure(
      'summary_d1',
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await second.measure('access_jwt', async () => {
      clock = 12;
    });
    expect(second.header()).toBe('worker;dur=7.00, access_jwt;dur=7.00');
    clock = 20;
    complete();
    await pending;
    expect(first.header()).toBe('worker;dur=20.00, summary_d1;dur=15.00');
    let calls = 0;
    expect(await measureTiming(undefined, 'summary_d1', async () => ++calls)).toBe(1);
    expect(calls).toBe(1);
  });

  it('零耗时有效，时钟精度或无效值不会生成负数、NaN 或 Infinity', async () => {
    let clock = 5;
    const timings = new RequestTimings(() => clock);
    await timings.measure('access_jwt', async () => {});
    await timings.measure('account_store', async () => {
      clock = 4;
    });
    await timings.measure('summary_d1', async () => {
      clock = Infinity;
    });
    expect(timings.header()).toBe(
      'worker;dur=0.00, access_jwt;dur=0.00, account_store;dur=0.00, summary_d1;dur=0.00',
    );
  });
});
