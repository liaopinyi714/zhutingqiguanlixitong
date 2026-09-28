import { Hono } from 'hono';
import { z } from 'zod';
import { AuthError, isLocalDemo, readStaffAccounts, type AuthEnv, type Session } from './auth';

export type Account = {
  email: string;
  tenant_id: string;
  name: string;
  store_name: string;
  enabled: number;
  source: 'config' | 'managed';
};
type Env = AuthEnv & { DB: D1Database };
export function configuredAccounts(env: AuthEnv, demo: boolean): Account[] {
  if (demo)
    return [
      {
        email: 'owner@demo.invalid',
        tenant_id: 'demo-store',
        name: '演示店主',
        store_name: '聆序听力 · 演示门店',
        enabled: 1,
        source: 'config',
      },
    ];
  return readStaffAccounts(env.STAFF_ACCOUNTS)
    .filter((a) => a.role === '店主')
    .map((a) => ({
      email: a.email,
      tenant_id: a.tenantId,
      name: a.name,
      store_name: a.storeName,
      enabled: 1,
      source: 'config',
    }));
}
export async function resolveAccount(env: Env, email: string, demo = false): Promise<Session> {
  const configured = configuredAccounts(env, demo).find((a) => a.email === email);
  const saved = await env.DB.prepare('SELECT * FROM accounts WHERE email=?')
    .bind(email)
    .first<Account>();
  // Configuration-backed accounts lose access when removed from the configuration.
  const account =
    saved?.source === 'managed'
      ? saved
      : configured
        ? saved?.tenant_id === configured.tenant_id
          ? { ...configured, name: saved.name, enabled: saved.enabled }
          : configured
        : undefined;
  if (!account || !account.enabled) throw new AuthError('此账户未获授权或已停用，请联系店主', 403);
  return {
    role: '店主',
    tenant_id: account.tenant_id,
    name: account.name,
    email,
    storeName: account.store_name,
    actor: `${account.name} <${email}>`,
  };
}
export const accountRoutes = new Hono<{ Bindings: Env; Variables: { session: Session } }>();
accountRoutes.get('/', async (c) => {
  const s = c.get('session');
  const configured = configuredAccounts(c.env, isLocalDemo(c.env, c.req.url)).filter(
    (a) => a.tenant_id === s.tenant_id,
  );
  const saved = (
    await c.env.DB.prepare('SELECT * FROM accounts WHERE tenant_id=? ORDER BY name,email')
      .bind(s.tenant_id)
      .all<Account>()
  ).results;
  const merged = new Map(configured.map((a) => [a.email, a]));
  for (const a of saved) if (a.source === 'managed' || merged.has(a.email)) merged.set(a.email, a);
  return c.json(
    [...merged.values()].map((a) => ({
      email: a.email,
      name: a.name,
      enabled: !!a.enabled,
      self: a.email === s.email,
    })),
  );
});
const schema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  name: z.string().trim().min(1).max(60),
  enabled: z.boolean(),
});
accountRoutes.put('/', async (c) => {
  const p = schema.safeParse(await c.req.json());
  if (!p.success) return c.json({ error: '请填写有效邮箱和账户名称' }, 400);
  const s = c.get('session'),
    d = p.data;
  if (s.role !== '店主') return c.json({ error: '无权管理账户' }, 403);
  if (d.email === s.email && !d.enabled) return c.json({ error: '不能停用当前登录账户' }, 400);
  const config = isLocalDemo(c.env, c.req.url)
    ? configuredAccounts(c.env, true).map((a) => ({
        email: a.email,
        tenantId: a.tenant_id,
        role: '店主',
      }))
    : readStaffAccounts(c.env.STAFF_ACCOUNTS);
  const existingConfig = config.find((a) => a.email === d.email);
  const saved = await c.env.DB.prepare('SELECT * FROM accounts WHERE email=?')
    .bind(d.email)
    .first<Account>();
  if (
    (existingConfig && existingConfig.tenantId !== s.tenant_id) ||
    (saved && saved.tenant_id !== s.tenant_id)
  )
    return c.json({ error: '此邮箱已被使用，无法添加' }, 409);
  const source = saved?.source || (existingConfig?.role === '店主' ? 'config' : 'managed');
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO accounts(email,tenant_id,name,store_name,enabled,source) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE email=? AND enabled=0) ON CONFLICT(email) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,updated_at=CURRENT_TIMESTAMP WHERE accounts.tenant_id=excluded.tenant_id RETURNING email`,
    ).bind(d.email, s.tenant_id, d.name, s.storeName, d.enabled ? 1 : 0, source, s.email),
    c.env.DB.prepare(
      'INSERT INTO audit(id,tenant_id,actor,action,customer_id) SELECT ?,?,?,?,NULL WHERE changes()>0',
    ).bind(
      crypto.randomUUID(),
      s.tenant_id,
      s.actor,
      `${d.enabled ? '保存' : '停用'}店主账户：${d.email}`,
    ),
  ]);
  if (!result[0].results.length) return c.json({ error: '账户状态已变化，请刷新后重试' }, 409);
  return c.json({ ok: true });
});
