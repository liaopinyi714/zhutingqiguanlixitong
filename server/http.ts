import type { Hono } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { accessSession, AuthError, isLocalDemo } from './auth';
import { resolveAccount } from './accounts';
import type { AppContext } from './types';

// Register before every route. Ordering is part of the authentication boundary.
export function installHttpBoundary(app: Hono<AppContext>) {
  app.onError((err, c) => {
    if (err instanceof SyntaxError) return c.json({ error: '请求内容格式不正确' }, 400);
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
    // Do not log query values, customer content, tokens or attachment names.
    console.error('request_failed', { path: c.req.routePath, kind: err.name });
    return c.json({ error: '服务暂时不可用，请稍后重试。' }, 500);
  });
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    const demo = isLocalDemo(c.env, c.req.url);
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = c.req.header('Origin');
      if (
        origin &&
        origin !== new URL(c.req.url).origin &&
        !(demo && origin === 'http://127.0.0.1:5173')
      )
        return c.json({ error: '请求来源不受信任' }, 403);
      if (!demo && (!origin || c.req.header('X-Requested-With') !== 'hearing-care'))
        return c.json({ error: '请求校验失败，请刷新后重试' }, 403);
    }
    if (c.req.path === '/api/config') return next();
    // Logging out must remain possible after the operator revokes the identity
    // or a colleague removes its last store membership. Origin checks still apply.
    if (c.req.path === '/api/logout') return next();
    if (c.req.path === '/api/login') {
      if (!demo) return c.json({ error: '正式环境不支持演示角色登录' }, 403);
      return next();
    }
    // The cookie is only a default for a newly opened page. Existing tabs bind
    // requests to their displayed store, and still undergo membership checks.
    const explicitStore =
      c.req.header('X-Hearing-Store') ??
      (c.req.path.startsWith('/api/files/') ? c.req.query('store') : undefined);
    if (
      explicitStore !== undefined &&
      explicitStore !== '' &&
      !/^[a-zA-Z0-9_-]{1,64}$/.test(explicitStore)
    )
      return c.json({ error: '门店标识无效' }, 400);
    const selectedStore = explicitStore ?? getCookie(c, 'hearing_store');
    const mayRecover =
      c.req.path === '/api/me' ||
      c.req.path === '/api/accounts/stores' ||
      /^\/api\/accounts\/stores\/[^/]+\/switch$/.test(c.req.path);
    if (!demo) {
      const lookup = async (email: string) => {
        try {
          return await resolveAccount(c.env, email, false, selectedStore);
        } catch (error) {
          if (
            explicitStore !== undefined ||
            !selectedStore ||
            !mayRecover ||
            !(error instanceof AuthError)
          )
            throw error;
          deleteCookie(c, 'hearing_store', { path: '/' });
          return resolveAccount(c.env, email);
        }
      };
      c.set('session', await accessSession(c.req.raw, c.env, lookup));
      return next();
    }
    const token = getCookie(c, 'hearing_session');
    const s = token
      ? await c.env.DB.prepare('SELECT role,tenant_id FROM sessions WHERE token=? AND expires_at>?')
          .bind(token, Date.now())
          .first<{ role: string; tenant_id: string }>()
      : null;
    if (!s || s.role !== '店主') return c.json({ error: '请先登录工作台' }, 401);
    try {
      c.set('session', await resolveAccount(c.env, 'owner@demo.invalid', true, selectedStore));
    } catch (error) {
      if (
        explicitStore !== undefined ||
        !selectedStore ||
        !mayRecover ||
        !(error instanceof AuthError)
      )
        throw error;
      deleteCookie(c, 'hearing_store', { path: '/' });
      c.set('session', await resolveAccount(c.env, 'owner@demo.invalid', true));
    }
    await next();
  });
  app.use('/api/*', async (c, next) =>
    bodyLimit({
      maxSize: c.req.path.endsWith('/attachments') ? 11 * 1024 * 1024 : 128 * 1024,
      onError: (ctx) => ctx.json({ error: '提交内容过大，请缩小文件或减少文本' }, 413),
    })(c, next),
  );
  app.use('/api/*', async (c, next) => {
    const personal =
      ['/api/config', '/api/login', '/api/me', '/api/logout', '/api/auth/start'].includes(
        c.req.path,
      ) ||
      c.req.path === '/api/accounts' ||
      c.req.path.startsWith('/api/accounts/');
    if (!personal && !c.get('session')?.tenant_id)
      return c.json({ error: '请先加入或创建门店，再访问客户和业务资料' }, 403);
    if (
      !personal &&
      !['GET', 'HEAD'].includes(c.req.method) &&
      !isLocalDemo(c.env, c.req.url) &&
      !c.req.header('X-Hearing-Store')
    )
      return c.json({ error: '页面版本已更新，请刷新后再保存资料' }, 409);
    return next();
  });
}
