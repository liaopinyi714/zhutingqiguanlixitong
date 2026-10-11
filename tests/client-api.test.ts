import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('业务请求绑定已显示的门店，切换和退出仍可操作', async () => {
  const fetcher = vi.fn(async (url: string, _options: any) =>
    Response.json(url === '/api/me' ? { tenant_id: 'store-a' } : { ok: true }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { api } = await import('../src/api');
  await api('/me');
  await api('/customers', 'POST', { name: '测试' });
  expect(fetcher.mock.calls[1][1].headers['X-Hearing-Store']).toBe('store-a');
  await api('/accounts/stores/store-b/switch', 'POST');
  expect(fetcher.mock.calls[2][1].headers['X-Hearing-Store']).toBeUndefined();
  await api('/logout', 'POST');
  await api('/me');
  expect(fetcher.mock.calls[4][1].headers['X-Hearing-Store']).toBeUndefined();
});

it('权限错误不改变当前范围，也不把登录跳转当作有效业务响应', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { api } = await import('../src/api');
  fetcher.mockResolvedValueOnce(Response.json({ tenant_id: 'store-a' }));
  await api('/me');
  fetcher.mockResolvedValueOnce(Response.json({ error: '权限已撤销' }, { status: 403 }));
  await expect(api('/me')).rejects.toThrow('权限已撤销');
  fetcher.mockResolvedValueOnce(
    new Response('<html>登录</html>', { headers: { 'Content-Type': 'text/html' } }),
  );
  await expect(api('/customers')).rejects.toThrow('登录可能已过期');
  expect(fetcher.mock.calls[2][1].headers['X-Hearing-Store']).toBe('store-a');
});

it('退出后迟到的身份响应不能恢复旧的门店范围', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementation(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  const { api } = await import('../src/api');
  const pending = api('/me');
  await api('/logout', 'POST');
  finish(Response.json({ tenant_id: 'old-store' }));
  await pending;
  await api('/me');
  expect(fetcher.mock.calls[2][1].headers['X-Hearing-Store']).toBeUndefined();
});

it('保留分页和单客错误的状态码，供游标重置和档案不存在处理', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { api, ApiError } = await import('../src/api');
  for (const status of [400, 404]) {
    fetcher.mockResolvedValueOnce(Response.json({ error: '受控错误' }, { status }));
    const error = await api('/customers?paged=1').catch((reason) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(status);
  }
});

it('过时的读取可取消，取消后不重试，也不影响后续写入', async () => {
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason));
        }),
    )
    .mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  const { api } = await import('../src/api');
  const controller = new AbortController();
  const pending = api('/customers?paged=1', 'GET', undefined, controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);

  await api('/customers', 'POST', { name: '测试' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][1].signal).toBeUndefined();
});

it('取消后迟到的身份正文不能更新当前门店范围', async () => {
  let finish!: (value: unknown) => void;
  let parsing!: () => void;
  const started = new Promise<void>((resolve) => {
    parsing = resolve;
  });
  const body = new Promise((resolve) => {
    finish = resolve;
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ tenant_id: 'store-a' }))
    .mockResolvedValueOnce({
      type: 'basic',
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => {
        parsing();
        return body;
      },
    })
    .mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  const { api } = await import('../src/api');
  await api('/me');
  const controller = new AbortController();
  const pending = api('/me', 'GET', undefined, controller.signal);
  await started;
  controller.abort();
  finish({ tenant_id: 'outdated-store' });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await api('/customers?paged=1');
  expect(fetcher.mock.calls[2][1].headers['X-Hearing-Store']).toBe('store-a');
});
