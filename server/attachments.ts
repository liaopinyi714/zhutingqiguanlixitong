import { Hono } from 'hono';
import type { AppContext } from './types';
import { canWrite } from './domain';
import { retentionCutoff } from './retention';
import { activeCustomerWrite, commitWrite } from './mutations';

// Mounted after the HTTP boundary and active customer middleware.
export const attachmentRoutes = new Hono<AppContext>();
const id = () => crypto.randomUUID();

attachmentRoutes.post('/customers/:id/attachments', async (c) => {
  if (Number(c.req.header('Content-Length') || 0) > 11 * 1024 * 1024)
    return c.json({ error: '文件不能超过 10 MB' }, 413);
  const data = await c.req.formData(),
    file = data.get('file');
  if (
    !(file instanceof File) ||
    file.size > 10 * 1024 * 1024 ||
    !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)
  )
    return c.json({ error: '支持 10 MB 以内的 PDF、JPG、PNG' }, 400);
  const bytes = await file.arrayBuffer(),
    head = new Uint8Array(bytes);
  const valid =
    file.type === 'application/pdf'
      ? String.fromCharCode(...head.slice(0, 5)) === '%PDF-'
      : file.type === 'image/png'
        ? head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71
        : head[0] === 255 && head[1] === 216 && head[2] === 255;
  if (!valid) return c.json({ error: '文件内容与格式不符' }, 400);
  const s = c.get('session'),
    k = id(),
    key = `${s.tenant_id}/${c.req.param('id')}/${k}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } });
  try {
    await commitWrite(
      c.env.DB,
      s,
      c.env.DB.prepare(
        `INSERT INTO attachments(id,tenant_id,customer_id,name,mime,size,object_key) SELECT ?,?,?,?,?,?,?
         WHERE ${activeCustomerWrite} RETURNING id`,
      ).bind(
        k,
        s.tenant_id,
        c.req.param('id'),
        file.name.slice(0, 200),
        file.type,
        file.size,
        key,
        c.req.param('id'),
        s.tenant_id,
        s.email,
      ),
      '上传检查报告',
      c.req.param('id'),
    );
  } catch (e) {
    await c.env.FILES.delete(key);
    throw e;
  }
  return c.json({ id: k }, 201);
});
attachmentRoutes.delete('/customers/:id/attachments/:recordId', async (c) => {
  const s = c.get('session'),
    customer = c.req.param('id'),
    record = c.req.param('recordId');
  if (!canWrite(s.role, 'exam')) return c.json({ error: '当前角色无权删除报告附件' }, 403);
  const existing = await c.env.DB.prepare(
    'SELECT id FROM attachments WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NULL',
  )
    .bind(record, customer, s.tenant_id)
    .first();
  if (!existing) return c.json({ error: '附件不存在或已删除' }, 404);
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `UPDATE attachments SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND customer_id=? AND tenant_id=?
       AND deleted_at IS NULL AND ${activeCustomerWrite} RETURNING id`,
    ).bind(record, customer, s.tenant_id, customer, s.tenant_id, s.email),
    '删除报告附件',
    customer,
  );
  return c.json({ ok: true });
});
attachmentRoutes.post('/customers/:id/attachments/:recordId/restore', async (c) => {
  const s = c.get('session'),
    customer = c.req.param('id'),
    record = c.req.param('recordId');
  if (!canWrite(s.role, 'exam')) return c.json({ error: '当前角色无权恢复报告附件' }, 403);
  const existing = await c.env.DB.prepare(
    'SELECT id FROM attachments WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NOT NULL AND deleted_at>?',
  )
    .bind(record, customer, s.tenant_id, retentionCutoff())
    .first();
  if (!existing) return c.json({ error: '已删除附件不存在或超过恢复期限' }, 404);
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `UPDATE attachments SET deleted_at=NULL WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at>datetime('now','-30 days')
       AND ${activeCustomerWrite} RETURNING id`,
    ).bind(record, customer, s.tenant_id, customer, s.tenant_id, s.email),
    '恢复报告附件',
    customer,
  );
  return c.json({ ok: true });
});
attachmentRoutes.get('/files/:id', async (c) => {
  const r = await c.env.DB.prepare(
    'SELECT a.* FROM attachments a JOIN customers c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id AND c.deleted_at IS NULL WHERE a.id=? AND a.tenant_id=? AND a.deleted_at IS NULL',
  )
    .bind(c.req.param('id'), c.get('session').tenant_id)
    .first<any>();
  if (!r) return c.json({ error: '文件不存在' }, 404);
  const obj = await c.env.FILES.get(r.object_key);
  if (!obj) return c.json({ error: '文件不存在' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': r.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
