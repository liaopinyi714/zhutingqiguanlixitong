import { Hono } from 'hono';
import type { AppContext } from './types';

export const exportRoutes = new Hono<AppContext>();

exportRoutes.get('/', async (c) => {
  const s = c.get('session');
  if (s.role !== '店主') return c.json({ error: '只有店主可以导出全部资料' }, 403);
  const tables = [
    'customers',
    'exams',
    'fittings',
    'repairs',
    'followups',
    'attachments',
    'audit',
    'device_brands',
    'device_series',
    'device_models',
  ];
  const rows = await c.env.DB.batch(
    tables.map((t) => c.env.DB.prepare(`SELECT * FROM ${t} WHERE tenant_id=?`).bind(s.tenant_id)),
  );
  return c.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    note: '附件元数据已包含；文件需在客户档案中单独下载。',
    ...Object.fromEntries(tables.map((t, i) => [t, rows[i].results])),
  });
});
// Spreadsheet exports are a deliberately smaller, active-record snapshot. The
// original JSON endpoint retains soft-deleted business data and audit rows, but
// full recovery still needs a database export, private files and identity config.
exportRoutes.get('/spreadsheet', async (c) => {
  const s = c.get('session');
  if (s.role !== '店主') return c.json({ error: '只有店主可以导出客户表格' }, 403);
  const tenant = s.tenant_id;
  const [customers, exams, fittings, repairs, followups] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id,name,gender,birth_date,phone,contact,contact_phone,address,source,status,created_at
      FROM customers WHERE tenant_id=? AND deleted_at IS NULL ORDER BY name,id`,
    ).bind(tenant),
    c.env.DB.prepare(
      `WITH ranked AS (
      SELECT e.id,e.customer_id,e.date,e.data,
        ROW_NUMBER() OVER (PARTITION BY e.customer_id ORDER BY e.date DESC,e.created_at DESC,e.id DESC) AS rank
      FROM exams e JOIN customers c ON c.id=e.customer_id AND c.tenant_id=e.tenant_id AND c.deleted_at IS NULL
      WHERE e.tenant_id=? AND e.deleted_at IS NULL
    ) SELECT id,customer_id,date,data FROM ranked WHERE rank=1 ORDER BY customer_id`,
    ).bind(tenant),
    c.env.DB.prepare(
      `SELECT f.id,f.customer_id,f.date,f.data FROM fittings f
      JOIN customers c ON c.id=f.customer_id AND c.tenant_id=f.tenant_id AND c.deleted_at IS NULL
      WHERE f.tenant_id=? AND f.deleted_at IS NULL
      ORDER BY f.customer_id,f.date DESC,f.created_at DESC,f.id DESC`,
    ).bind(tenant),
    c.env.DB.prepare(
      `SELECT r.id,r.customer_id,r.fitting_id,r.occurred_date,r.received_date,r.completed_date,
      r.status,r.problem,r.work_done,r.parts,r.price,r.warranty_covered FROM repairs r
      JOIN customers c ON c.id=r.customer_id AND c.tenant_id=r.tenant_id AND c.deleted_at IS NULL
      JOIN fittings f ON f.id=r.fitting_id AND f.customer_id=r.customer_id AND f.tenant_id=r.tenant_id AND f.deleted_at IS NULL
      WHERE r.tenant_id=? AND r.deleted_at IS NULL ORDER BY r.customer_id,r.occurred_date DESC,r.id DESC`,
    ).bind(tenant),
    c.env.DB.prepare(
      `SELECT u.id,u.customer_id,u.due,u.type,u.completed,u.completed_at,u.result
      FROM followups u JOIN customers c ON c.id=u.customer_id AND c.tenant_id=u.tenant_id AND c.deleted_at IS NULL
      WHERE u.tenant_id=? AND u.deleted_at IS NULL ORDER BY u.customer_id,u.due DESC,u.id DESC`,
    ).bind(tenant),
  ]);
  return c.json({
    exportedAt: new Date().toISOString(),
    customers: customers.results,
    exams: exams.results,
    fittings: fittings.results,
    repairs: repairs.results,
    followups: followups.results,
  });
});
