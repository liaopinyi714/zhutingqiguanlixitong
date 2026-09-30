// Per-tab scope must not follow the cookie changed by a different browser tab.
let requestStore: string | undefined;
let sessionVersion = 0;

export async function api(path: string, method = 'GET', data?: unknown) {
  if (path === '/logout') sessionVersion++;
  const version = sessionVersion;
  const personal = ['/config', '/login', '/logout'].includes(path);
  const switching = /^\/accounts\/stores\/[^/]+\/switch$/.test(path);
  const response = await fetch('/api' + path, {
    method,
    headers: {
      'X-Requested-With': 'hearing-care',
      ...(requestStore !== undefined && !personal && !switching
        ? { 'X-Hearing-Store': requestStore }
        : {}),
      ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
    redirect: 'manual',
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
  });
  if (
    response.type === 'opaqueredirect' ||
    !response.headers.get('Content-Type')?.includes('application/json')
  )
    throw new Error('登录可能已过期。请先保存未提交的内容，再刷新页面重新登录。');
  const result: any = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  if (path === '/me' && version === sessionVersion) requestStore = result.tenant_id;
  if (path === '/logout') requestStore = undefined;
  return result;
}
