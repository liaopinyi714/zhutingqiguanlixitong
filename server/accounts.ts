import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { AuthError, isLocalDemo, readStaffAccounts, type AuthEnv, type Session } from './auth';
import { validAvatar } from './avatar';
import { retentionCutoff } from './retention';

type Env = AuthEnv & { DB: D1Database };
type Account = {
  email: string; tenant_id: string; name: string; store_name: string;
  enabled: number; source: 'config' | 'managed';
};
type Store = {
  id: string; name: string; member_name: string;
  enabled: number; source: 'config' | 'managed'; avatar: string;
};

export function configuredAccounts(env: AuthEnv, demo: boolean): Account[] {
  if (demo) return [{
    email: 'owner@demo.invalid', tenant_id: 'demo-store', name: '演示店主',
    store_name: '聆讯听力 · 演示门店', enabled: 1, source: 'config',
  }];
  return readStaffAccounts(env.STAFF_ACCOUNTS).filter((a) => a.role === '店主').map((a) => ({
    email: a.email, tenant_id: a.tenantId, name: a.name,
    store_name: a.storeName, enabled: 1, source: 'config' as const,
  }));
}

async function accountProfile(env: Env, email: string, demo: boolean) {
  const configured = configuredAccounts(env, demo).find((a) => a.email === email);
  const saved = await env.DB.prepare('SELECT * FROM accounts WHERE email=?').bind(email).first<Account>();
  // Removing a bootstrap identity from STAFF_ACCOUNTS revokes all of its access.
  const account = saved?.source === 'managed' ? saved : configured
    ? saved?.tenant_id === configured.tenant_id
      ? { ...configured, name: saved.name } : configured : undefined;
  if (!account) throw new AuthError('此账户未获授权，请联系店主', 403);
  return { account, configured };
}

async function storesForAccount(env: Env, email: string, configured?: Account): Promise<Store[]> {
  const rows = (await env.DB.prepare(
    `SELECT m.tenant_id id, s.name, m.name member_name, m.enabled, m.source, m.avatar
     FROM store_memberships m JOIN stores s ON s.id=m.tenant_id
     WHERE m.email=? AND s.deleted_at IS NULL ORDER BY s.created_at, s.name`,
  ).bind(email).all<Store>()).results;
  if (!configured) return rows.filter((row) => row.enabled && row.source === 'managed');
  if (!rows.some((row) => row.id === configured.tenant_id)) {
    const named = await env.DB.prepare('SELECT name,deleted_at FROM stores WHERE id=?')
      .bind(configured.tenant_id).first<{ name: string; deleted_at: string | null }>();
    if (!named?.deleted_at) rows.unshift({ id: configured.tenant_id, name: named?.name || configured.store_name,
      member_name: configured.name, enabled: 1, source: 'config', avatar: '' });
  }
  return rows.filter((row) => !!row.enabled);
}

export async function resolveAccount(
  env: Env, email: string, demo = false, selectedStore?: string,
): Promise<Session> {
  const { account, configured } = await accountProfile(env, email, demo);
  const stores = await storesForAccount(env, email, configured);
  const store = selectedStore ? stores.find((row) => row.id === selectedStore)
    : stores.find((row) => row.id === account.tenant_id) || stores[0];
  if (!store) throw new AuthError('此账户没有当前门店的访问权限', 403);
  return {
    role: '店主', tenant_id: store.id, name: store.member_name || account.name, email,
    storeName: store.name, actor: `${store.member_name || account.name} <${email}>`,
    avatar: store.avatar || '',
  };
}

const accountSchema = z.object({
  email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
  name: z.string().trim().min(1).max(60),
  enabled: z.boolean(),
  avatar: z.string().refine(validAvatar).optional(),
});
const storeSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const accountRoutes = new Hono<{ Bindings: Env; Variables: { session: Session } }>();

accountRoutes.get('/', async (c) => {
  const s = c.get('session');
  const config = configuredAccounts(c.env, isLocalDemo(c.env, c.req.url));
  const configEmails = new Set(config.map((a) => a.email));
  const saved = (await c.env.DB.prepare(
    `SELECT a.email, m.name, m.enabled, m.source, m.last_seen_at, m.avatar
     FROM store_memberships m JOIN accounts a ON a.email=m.email
     WHERE m.tenant_id=? ORDER BY a.name,a.email`,
  ).bind(s.tenant_id).all<{
    email: string; name: string; enabled: number; source: string; last_seen_at: number | null; avatar: string;
  }>()).results;
  const merged = new Map(config.filter((a) => a.tenant_id === s.tenant_id).map((a) => [a.email, {
    email: a.email, name: a.name, enabled: true, last_seen_at: null as number | null, avatar: '',
  }]));
  for (const row of saved) {
    if (row.source === 'managed' || configEmails.has(row.email))
      merged.set(row.email, { email: row.email, name: row.name,
        enabled: !!row.enabled, last_seen_at: row.last_seen_at, avatar: row.avatar || '' });
  }
  return c.json([...merged.values()].map((row) => ({
    email: row.email, name: row.name, enabled: row.enabled, self: row.email === s.email,
    online: row.enabled && !!row.last_seen_at && Date.now() - row.last_seen_at < 150000,
    lastSeenAt: row.last_seen_at,
    avatar: row.avatar,
  })));
});

accountRoutes.put('/', async (c) => {
  const parsed = accountSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '请检查邮箱、名称和头像（仅支持压缩后的 PNG/JPEG 图片）' }, 400);
  const s = c.get('session'), d = parsed.data;
  if (d.email === s.email && !d.enabled)
    return c.json({ error: '不能停用当前门店的自己' }, 400);
  const existingConfig = configuredAccounts(c.env, isLocalDemo(c.env, c.req.url))
    .find((a) => a.email === d.email);
  const existing = await c.env.DB.prepare('SELECT * FROM accounts WHERE email=?')
    .bind(d.email).first<Account>();
  const membership = await c.env.DB.prepare('SELECT avatar FROM store_memberships WHERE email=? AND tenant_id=?')
    .bind(d.email, s.tenant_id).first<{ avatar: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO stores(id,name) VALUES(?,?)')
      .bind(s.tenant_id, s.storeName),
    c.env.DB.prepare(
      `INSERT INTO accounts(email,tenant_id,name,store_name,enabled,source)
       VALUES(?,?,?,?,1,?) ON CONFLICT(email) DO NOTHING`,
    ).bind(d.email, existing?.tenant_id || existingConfig?.tenant_id || s.tenant_id,
      d.name, existing?.store_name || existingConfig?.store_name || s.storeName,
      existing?.source || existingConfig?.source || 'managed'),
    c.env.DB.prepare(
      `INSERT INTO store_memberships(email,tenant_id,name,enabled,source,avatar)
       VALUES(?,?,?,?,?,?) ON CONFLICT(email,tenant_id) DO UPDATE SET
       name=excluded.name,enabled=excluded.enabled,avatar=excluded.avatar`,
    ).bind(d.email, s.tenant_id, d.name, d.enabled ? 1 : 0,
      existingConfig?.tenant_id === s.tenant_id ? 'config' : 'managed', d.avatar ?? membership?.avatar ?? ''),
    c.env.DB.prepare(
      'INSERT INTO audit(id,tenant_id,actor,action,customer_id) VALUES(?,?,?,?,NULL)',
    ).bind(crypto.randomUUID(), s.tenant_id, s.actor,
      `${d.enabled ? '保存' : '停用'}店主账户：${d.email}`),
  ]);
  return c.json({ ok: true });
});

accountRoutes.post('/presence', async (c) => {
  const s = c.get('session');
  const config = configuredAccounts(c.env, isLocalDemo(c.env, c.req.url))
    .find((a) => a.email === s.email && a.tenant_id === s.tenant_id);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO stores(id,name) VALUES(?,?)')
      .bind(s.tenant_id, s.storeName),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO accounts(email,tenant_id,name,store_name,enabled,source)
       VALUES(?,?,?,?,1,?)`,
    ).bind(s.email, s.tenant_id, s.name, s.storeName, config ? 'config' : 'managed'),
    c.env.DB.prepare(
      `INSERT INTO store_memberships(email,tenant_id,name,enabled,source,last_seen_at)
       VALUES(?,?,?,1,?,?) ON CONFLICT(email,tenant_id) DO UPDATE SET
       last_seen_at=excluded.last_seen_at`,
    ).bind(s.email, s.tenant_id, s.name, config ? 'config' : 'managed', Date.now()),
  ]);
  return c.json({ ok: true });
});

accountRoutes.get('/stores', async (c) => {
  const s = c.get('session');
  const { configured } = await accountProfile(c.env, s.email || '',
    isLocalDemo(c.env, c.req.url));
  const stores = await storesForAccount(c.env, s.email || '', configured);
  return c.json(stores.map((store) => ({
    id: store.id, name: store.name, current: store.id === s.tenant_id,
  })));
});

accountRoutes.get('/stores/removed', async (c) => {
  const s = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT s.id,s.name,s.deleted_at FROM stores s
     JOIN store_memberships m ON m.tenant_id=s.id
     WHERE m.email=? AND m.enabled=1 AND s.deleted_at>?
     ORDER BY s.deleted_at DESC`,
  ).bind(s.email, retentionCutoff()).all();
  return c.json(rows.results);
});

accountRoutes.delete('/stores/:id', async (c) => {
  const s = c.get('session');
  if (c.req.param('id') !== s.tenant_id)
    return c.json({ error: '请先切换到要删除的门店' }, 403);
  const parsed = storeSchema.safeParse(await c.req.json());
  if (!parsed.success || parsed.data.name !== s.storeName)
    return c.json({ error: '请输入完整门店名称确认删除' }, 400);
  const { configured } = await accountProfile(c.env, s.email || '', isLocalDemo(c.env, c.req.url));
  const other = (await storesForAccount(c.env, s.email || '', configured)).find((row) => row.id !== s.tenant_id);
  if (!other) return c.json({ error: '不能删除唯一可进入的门店，请先创建或加入另一家门店' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO stores(id,name) VALUES(?,?)').bind(s.tenant_id, s.storeName),
    c.env.DB.prepare('UPDATE stores SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL')
      .bind(s.tenant_id),
    c.env.DB.prepare('INSERT INTO audit(id,tenant_id,actor,action,customer_id) VALUES(?,?,?,?,NULL)')
      .bind(crypto.randomUUID(), s.tenant_id, s.actor, '删除门店'),
  ]);
  setCookie(c, 'hearing_store', other.id, {
    httpOnly: true, sameSite: 'Strict', secure: new URL(c.req.url).protocol === 'https:',
    path: '/', maxAge: 60 * 60 * 24 * 365,
  });
  return c.json({ ok: true, nextStoreId: other.id });
});

accountRoutes.post('/stores/:id/restore', async (c) => {
  const s = c.get('session');
  const row = await c.env.DB.prepare(
    `SELECT s.id FROM stores s JOIN store_memberships m ON m.tenant_id=s.id
     WHERE s.id=? AND m.email=? AND m.enabled=1 AND s.deleted_at>?`,
  ).bind(c.req.param('id'), s.email, retentionCutoff()).first();
  if (!row) return c.json({ error: '门店不存在、恢复期已过或没有恢复权限' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE stores SET deleted_at=NULL WHERE id=? AND deleted_at>?')
      .bind(c.req.param('id'), retentionCutoff()),
    c.env.DB.prepare('INSERT INTO audit(id,tenant_id,actor,action,customer_id) VALUES(?,?,?,?,NULL)')
      .bind(crypto.randomUUID(), c.req.param('id'), s.actor, '恢复门店'),
  ]);
  return c.json({ ok: true });
});

accountRoutes.post('/stores', async (c) => {
  const parsed = storeSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '请输入 1 至 80 字的门店名称' }, 400);
  const s = c.get('session'), storeId = `store-${crypto.randomUUID()}`;
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO stores(id,name) VALUES(?,?)')
      .bind(storeId, parsed.data.name),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO accounts(email,tenant_id,name,store_name,enabled,source)
       VALUES(?,?,?,?,1,'config')`,
    ).bind(s.email, s.tenant_id, s.name, s.storeName),
    c.env.DB.prepare(
      `INSERT INTO store_memberships(email,tenant_id,name,enabled,source)
       VALUES(?,?,?,1,'managed')`,
    ).bind(s.email, storeId, s.name),
    c.env.DB.prepare(
      'INSERT INTO audit(id,tenant_id,actor,action,customer_id) VALUES(?,?,?,?,NULL)',
    ).bind(crypto.randomUUID(), storeId, s.actor, `创建门店：${parsed.data.name}`),
  ]);
  return c.json({ id: storeId, name: parsed.data.name }, 201);
});

accountRoutes.patch('/stores/:id', async (c) => {
  const s = c.get('session');
  if (c.req.param('id') !== s.tenant_id)
    return c.json({ error: '请先切换到要修改的门店' }, 403);
  const parsed = storeSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '请输入 1 至 80 字的门店名称' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO stores(id,name) VALUES(?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name`,
    ).bind(s.tenant_id, parsed.data.name),
    c.env.DB.prepare(
      'INSERT INTO audit(id,tenant_id,actor,action,customer_id) VALUES(?,?,?,?,NULL)',
    ).bind(crypto.randomUUID(), s.tenant_id, s.actor,
      `门店更名：${s.storeName} → ${parsed.data.name}`),
  ]);
  return c.json({ ok: true, name: parsed.data.name });
});

accountRoutes.post('/stores/:id/switch', async (c) => {
  const s = c.get('session'), target = c.req.param('id');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(target))
    return c.json({ error: '门店不存在' }, 404);
  const next = await resolveAccount(c.env, s.email || '',
    isLocalDemo(c.env, c.req.url), target);
  setCookie(c, 'hearing_store', next.tenant_id, {
    httpOnly: true, sameSite: 'Strict', secure: new URL(c.req.url).protocol === 'https:',
    path: '/', maxAge: 60 * 60 * 24 * 365,
  });
  return c.json({ ok: true, store: { id: next.tenant_id, name: next.storeName } });
});
