import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { isLocalDemo, type AuthEnv, type Session } from './auth';
import { validAvatar } from './avatar';
import { retentionCutoff } from './retention';
import { activeStoreWrite, auditAfterWrite, commitWrite, WriteConflictError } from './mutations';
import { measureTiming } from './timing';
import {
  accountProfile,
  configuredAccounts,
  resolveAccount,
  storesForAccount,
} from './account-resolution';
import type { AppContext } from './types';

type Env = AuthEnv & { DB: D1Database };
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const accountSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(60).optional(),
  enabled: z.boolean(),
  avatar: z.string().refine(validAvatar).optional(),
});
const storeSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const accountRoutes = new Hono<AppContext>();

function audit(env: Env, s: Session, action: string, tenantId = s.tenant_id) {
  return env.DB.prepare(
    'INSERT INTO audit(id,tenant_id,actor,action,customer_id) VALUES(?,?,?,?,NULL)',
  ).bind(crypto.randomUUID(), tenantId, s.actor, action);
}
function markAbandoned(env: Env, storeId: string, demo: boolean) {
  const provided = configuredAccounts(env, demo).map((a) => ({
    email: a.email,
    tenantId: a.tenant_id,
  }));
  return env.DB.prepare(
    `UPDATE stores SET abandoned_at=COALESCE(abandoned_at,CURRENT_TIMESTAMP)
    WHERE id=? AND deleted_at IS NULL AND NOT EXISTS (
      SELECT 1 FROM store_memberships m,json_each(?) p WHERE m.tenant_id=stores.id AND m.enabled=1
        AND m.email=json_extract(p.value,'$.email'))`,
  ).bind(storeId, JSON.stringify(provided));
}
function selectCookie(c: Context<AppContext>, storeId: string) {
  if (!storeId) {
    deleteCookie(c, 'hearing_store', { path: '/' });
    return;
  }
  setCookie(c, 'hearing_store', storeId, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

accountRoutes.get('/', async (c) => {
  const s = c.get('session');
  if (!s.tenant_id)
    return c.json([
      {
        email: s.email,
        name: s.name,
        avatar: s.avatar,
        enabled: true,
        self: true,
        online: true,
        lastSeenAt: null,
      },
    ]);
  const provided = new Map(
    configuredAccounts(c.env, isLocalDemo(c.env, c.req.url)).map((a) => [a.email, a]),
  );
  const rows = (
    await c.env.DB.prepare(
      `SELECT a.email,a.name,a.avatar,m.enabled,m.last_seen_at,m.source,m.left_at FROM store_memberships m
     JOIN accounts a ON a.email=m.email WHERE m.tenant_id=? AND (m.left_at IS NULL OR m.left_at>?) ORDER BY a.name,a.email`,
    )
      .bind(s.tenant_id, retentionCutoff())
      .all<{
        email: string;
        name: string;
        avatar: string;
        enabled: number;
        last_seen_at: number | null;
        left_at: string | null;
      }>()
  ).results;
  return c.json(
    rows
      .filter((r) => provided.has(r.email))
      .map((r) => ({
        email: r.email,
        name: r.name,
        avatar: r.avatar || '',
        enabled: !!r.enabled,
        self: r.email === s.email,
        online: !!r.enabled && !!r.last_seen_at && Date.now() - r.last_seen_at < 150000,
        lastSeenAt: r.last_seen_at,
        leftAt: r.left_at,
      })),
  );
});

accountRoutes.put('/', async (c) => {
  const parsed = accountSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '请检查邮箱、姓名和头像' }, 400);
  const s = c.get('session'),
    d = parsed.data,
    demo = isLocalDemo(c.env, c.req.url);
  // Check before any write. Legacy managed accounts do not bypass provisioning.
  const provided = configuredAccounts(c.env, demo).find((a) => a.email === d.email);
  if (!provided)
    return c.json(
      { error: '该邮箱尚未由系统提供者授权，无法添加。请联系系统提供者开通账户。' },
      403,
    );
  if (d.email === s.email) {
    if (!d.enabled) return c.json({ error: '请使用退出门店操作' }, 400);
    if (!d.name) return c.json({ error: '请填写姓名' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE accounts SET name=?,avatar=COALESCE(?,avatar),updated_at=CURRENT_TIMESTAMP WHERE email=?',
      ).bind(d.name, d.avatar ?? null, s.email),
      c.env.DB.prepare('UPDATE store_memberships SET name=? WHERE email=?').bind(d.name, s.email),
      audit(c.env, s, '修改个人资料'),
    ]);
    return c.json({ ok: true });
  }
  if (!s.tenant_id) return c.json({ error: '请先进入门店' }, 403);
  const { account } = await accountProfile(c.env, d.email, demo);
  if ((d.name !== undefined && d.name !== account.name) || d.avatar !== undefined)
    return c.json({ error: '只能由账户本人修改姓名和头像' }, 403);
  const member = await c.env.DB.prepare(
    'SELECT email FROM store_memberships WHERE email=? AND tenant_id=?',
  )
    .bind(d.email, s.tenant_id)
    .first();
  if (!member && !d.enabled) return c.json({ error: '该账户尚未加入当前门店' }, 404);
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `INSERT INTO store_memberships(email,tenant_id,name,enabled,source,left_at)
       SELECT ?,?,?,?,'managed',NULL WHERE ${activeStoreWrite} ON CONFLICT(email,tenant_id) DO UPDATE SET
       enabled=excluded.enabled,left_at=NULL,source='managed' RETURNING email AS id`,
    ).bind(d.email, s.tenant_id, account.name, d.enabled ? 1 : 0, s.tenant_id, s.email),
    `${d.enabled ? '添加或启用' : '停用'}门店成员：${d.email}`,
  );
  return c.json({ ok: true });
});

accountRoutes.post('/presence', async (c) => {
  const s = c.get('session');
  if (s.tenant_id)
    await measureTiming(c.get('timings'), 'presence_d1', () =>
      c.env.DB.prepare(
        `UPDATE store_memberships SET last_seen_at=? WHERE email=? AND tenant_id=? AND enabled=1
       AND ${activeStoreWrite}`,
      )
        .bind(Date.now(), s.email, s.tenant_id, s.tenant_id, s.email)
        .run(),
    );
  return c.json({ ok: true });
});

accountRoutes.get('/stores', async (c) => {
  const s = c.get('session');
  const stores =
    c.get('accountResolution')?.stores ?? (await storesForAccount(c.env, s.email || ''));
  return c.json(
    stores.map((store) => ({ id: store.id, name: store.name, current: store.id === s.tenant_id })),
  );
});

accountRoutes.get('/stores/left', async (c) => {
  const s = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT s.id,s.name,m.left_at FROM stores s JOIN store_memberships m ON m.tenant_id=s.id
     WHERE m.email=? AND m.enabled=0 AND m.left_at>? AND s.deleted_at IS NULL
       AND (s.abandoned_at IS NULL OR s.abandoned_at>?)
     ORDER BY m.left_at DESC`,
  )
    .bind(s.email, retentionCutoff(), retentionCutoff())
    .all();
  return c.json(rows.results);
});

accountRoutes.post('/stores/:id/leave', async (c) => {
  const s = c.get('session');
  if (!s.tenant_id || c.req.param('id') !== s.tenant_id)
    return c.json({ error: '请先进入要退出的门店' }, 403);
  const [left] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE store_memberships SET enabled=0,left_at=CURRENT_TIMESTAMP,last_seen_at=NULL
       WHERE email=? AND tenant_id=? AND enabled=1 AND ${activeStoreWrite} RETURNING email AS id`,
    ).bind(s.email, s.tenant_id, s.tenant_id, s.email),
    auditAfterWrite(c.env.DB, s, '退出门店'),
    markAbandoned(c.env, s.tenant_id, isLocalDemo(c.env, c.req.url)),
  ]);
  if (!left.results.length) throw new WriteConflictError();
  const remaining = await storesForAccount(c.env, s.email || '');
  const nextStoreId = remaining[0]?.id || '';
  selectCookie(c, nextStoreId);
  return c.json({ ok: true, nextStoreId });
});

accountRoutes.post('/stores/:id/rejoin', async (c) => {
  const s = c.get('session'),
    target = c.req.param('id'),
    cutoff = retentionCutoff();
  const row = await c.env.DB.prepare(
    `SELECT m.left_at FROM store_memberships m JOIN stores t ON t.id=m.tenant_id
     WHERE m.email=? AND m.tenant_id=? AND m.enabled=0 AND m.left_at>?
       AND t.deleted_at IS NULL AND (t.abandoned_at IS NULL OR t.abandoned_at>?)`,
  )
    .bind(s.email, target, cutoff, cutoff)
    .first<{ left_at: string }>();
  if (!row) return c.json({ error: '门店不可恢复加入，请联系门店店主重新添加' }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE store_memberships SET enabled=1,left_at=NULL WHERE email=? AND tenant_id=? AND enabled=0 AND left_at=?
       AND left_at>datetime('now','-30 days') AND EXISTS(SELECT 1 FROM stores t WHERE t.id=store_memberships.tenant_id
         AND t.deleted_at IS NULL AND (t.abandoned_at IS NULL OR t.abandoned_at>datetime('now','-30 days')))`,
    ).bind(s.email, target, row.left_at),
    c.env.DB.prepare(
      `UPDATE stores SET abandoned_at=NULL WHERE id=? AND deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM store_memberships WHERE email=? AND tenant_id=? AND enabled=1 AND left_at IS NULL)`,
    ).bind(target, s.email, target),
    c.env.DB.prepare(
      `INSERT INTO audit(id,tenant_id,actor,action,customer_id)
      SELECT ?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM store_memberships
        WHERE email=? AND tenant_id=? AND enabled=1 AND left_at IS NULL)`,
    ).bind(crypto.randomUUID(), target, s.actor, '恢复加入门店', s.email, target),
  ]);
  const next = await resolveAccount(c.env, s.email || '', isLocalDemo(c.env, c.req.url), target);
  selectCookie(c, next.tenant_id);
  return c.json({ ok: true });
});

accountRoutes.get('/stores/removed', async (c) => {
  const s = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT s.id,s.name,s.deleted_at FROM stores s JOIN store_memberships m ON m.tenant_id=s.id
     WHERE m.email=? AND m.enabled=1 AND s.deleted_at>? ORDER BY s.deleted_at DESC`,
  )
    .bind(s.email, retentionCutoff())
    .all();
  return c.json(rows.results);
});

accountRoutes.delete('/stores/:id', async (c) => {
  const s = c.get('session');
  if (!s.tenant_id || c.req.param('id') !== s.tenant_id)
    return c.json({ error: '请先切换到要删除的门店' }, 403);
  const parsed = storeSchema.safeParse(await c.req.json());
  if (!parsed.success || parsed.data.name !== s.storeName)
    return c.json({ error: '请输入完整门店名称确认删除' }, 400);
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `UPDATE stores SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND name=? AND deleted_at IS NULL
       AND ${activeStoreWrite} RETURNING id`,
    ).bind(s.tenant_id, parsed.data.name, s.tenant_id, s.email),
    '删除门店',
  );
  const other = (await storesForAccount(c.env, s.email || ''))[0];
  selectCookie(c, other?.id || '');
  return c.json({ ok: true, nextStoreId: other?.id || '' });
});

accountRoutes.post('/stores/:id/restore', async (c) => {
  const s = c.get('session'),
    target = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT s.id FROM stores s JOIN store_memberships m ON m.tenant_id=s.id
     WHERE s.id=? AND m.email=? AND m.enabled=1 AND s.deleted_at>?`,
  )
    .bind(target, s.email, retentionCutoff())
    .first();
  if (!row) return c.json({ error: '门店不存在、恢复期已过或没有恢复权限' }, 404);
  const [restored] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE stores SET deleted_at=NULL,abandoned_at=NULL WHERE id=? AND deleted_at>datetime('now','-30 days')
       AND EXISTS(SELECT 1 FROM store_memberships m WHERE m.tenant_id=stores.id AND m.email=? AND m.enabled=1) RETURNING id`,
    ).bind(target, s.email),
    c.env.DB.prepare(
      'INSERT INTO audit(id,tenant_id,actor,action,customer_id) SELECT ?,?,?,?,NULL WHERE changes()>0',
    ).bind(crypto.randomUUID(), target, s.actor, '恢复门店'),
  ]);
  if (!restored.results.length)
    return c.json({ error: '门店状态或恢复权限已变化，请刷新后重试' }, 409);
  return c.json({ ok: true });
});

accountRoutes.post('/stores', async (c) => {
  const parsed = storeSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '请输入 1 至 80 字的门店名称' }, 400);
  const s = c.get('session'),
    storeId = `store-${crypto.randomUUID()}`;
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO stores(id,name) VALUES(?,?)').bind(storeId, parsed.data.name),
    c.env.DB.prepare(
      "INSERT INTO store_memberships(email,tenant_id,name,enabled,source) VALUES(?,?,?,1,'managed')",
    ).bind(s.email, storeId, s.name),
    audit(c.env, s, `创建门店：${parsed.data.name}`, storeId),
  ]);
  return c.json({ id: storeId, name: parsed.data.name }, 201);
});

accountRoutes.patch('/stores/:id', async (c) => {
  const s = c.get('session');
  if (!s.tenant_id || c.req.param('id') !== s.tenant_id)
    return c.json({ error: '请先切换到要修改的门店' }, 403);
  const parsed = storeSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '请输入 1 至 80 字的门店名称' }, 400);
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `UPDATE stores SET name=? WHERE id=? AND deleted_at IS NULL AND ${activeStoreWrite} RETURNING id`,
    ).bind(parsed.data.name, s.tenant_id, s.tenant_id, s.email),
    `门店更名：${s.storeName} → ${parsed.data.name}`,
  );
  return c.json({ ok: true, name: parsed.data.name });
});

accountRoutes.post('/stores/:id/switch', async (c) => {
  const s = c.get('session'),
    target = c.req.param('id');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(target)) return c.json({ error: '门店不存在' }, 404);
  const next = await resolveAccount(c.env, s.email || '', isLocalDemo(c.env, c.req.url), target);
  selectCookie(c, next.tenant_id);
  return c.json({ ok: true, store: { id: next.tenant_id, name: next.storeName } });
});
