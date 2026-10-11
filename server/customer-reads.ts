import type { Context, Hono } from 'hono';
import type { AppContext } from './types';
import { retentionCutoff } from './retention';

type Section = 'exams' | 'fittings' | 'followups' | 'attachments' | 'audit' | 'repairs';
type SectionQuery = {
  table: Section;
  columns: string;
  where: string;
  order: string;
};
const detailSections: SectionQuery[] = [
  {
    table: 'exams',
    columns: 'r.*',
    where: 'r.deleted_at IS NULL',
    order: 'r.date DESC,r.created_at DESC',
  },
  {
    table: 'fittings',
    columns: 'r.*',
    where: 'r.deleted_at IS NULL',
    order: 'r.date DESC,r.created_at DESC',
  },
  { table: 'followups', columns: 'r.*', where: 'r.deleted_at IS NULL', order: 'r.due DESC' },
  {
    table: 'attachments',
    columns: 'r.*',
    where: 'r.deleted_at IS NULL',
    order: 'r.created_at DESC',
  },
  { table: 'audit', columns: 'r.*', where: '1', order: 'r.created_at DESC' },
  {
    table: 'repairs',
    columns: 'r.*',
    where: 'r.deleted_at IS NULL',
    order: 'r.occurred_date DESC,r.created_at DESC',
  },
];
const removedSections: SectionQuery[] = [
  {
    table: 'exams',
    columns: 'r.id,r.date,r.data,r.deleted_at',
    where: 'r.deleted_at>?',
    order: 'r.deleted_at DESC',
  },
  {
    table: 'fittings',
    columns: 'r.id,r.date,r.data,r.deleted_at',
    where: 'r.deleted_at>?',
    order: 'r.deleted_at DESC',
  },
  { table: 'followups', columns: 'r.*', where: 'r.deleted_at>?', order: 'r.deleted_at DESC' },
  {
    table: 'attachments',
    columns: 'r.id,r.name,r.size,r.created_at,r.deleted_at',
    where: 'r.deleted_at>?',
    order: 'r.deleted_at DESC',
  },
  { table: 'repairs', columns: 'r.*', where: 'r.deleted_at>?', order: 'r.deleted_at DESC' },
];

async function readSections(
  c: Context<AppContext>,
  sections: SectionQuery[],
  extraValues: string[] = [],
) {
  const tenant = c.get('session').tenant_id,
    customer = c.req.param('id');
  // Parent existence and all sections share one D1 batch/snapshot. Every child
  // query checks the active parent too, so a missing, deleted or foreign-store
  // customer cannot cause its records to be read while we decide the 404.
  const [parent, ...results] = await c.env.DB.batch([
    c.env.DB.prepare(
      'SELECT id FROM customers WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
    ).bind(customer, tenant),
    ...sections.map(({ table, columns, where, order }) =>
      c.env.DB.prepare(
        `SELECT ${columns} FROM ${table} r
         JOIN customers c ON c.id=r.customer_id AND c.tenant_id=r.tenant_id AND c.deleted_at IS NULL
         ${table === 'repairs' ? 'JOIN fittings f ON f.id=r.fitting_id AND f.tenant_id=r.tenant_id AND f.customer_id=r.customer_id AND f.deleted_at IS NULL' : ''}
         WHERE r.tenant_id=? AND r.customer_id=? AND ${where} ORDER BY ${order}`,
      ).bind(tenant, customer, ...extraValues),
    ),
  ]);
  if (!parent.results.length) return c.json({ error: '档案不存在' }, 404);
  return c.json(
    Object.fromEntries(
      sections.map(({ table }, i) => [
        table,
        results[i].results.map((row: any) =>
          row.data ? { ...row, ...JSON.parse(row.data) } : row,
        ),
      ]),
    ),
  );
}

// Install after the common authentication boundary and before the customer
// write preflight middleware. Writes keep their preflight and transaction guards.
export function installCustomerReadRoutes(app: Hono<AppContext>) {
  app.get('/api/customers/:id/detail', (c) => readSections(c, detailSections));
  app.get('/api/customers/:id/removed', (c) =>
    readSections(c, removedSections, [retentionCutoff()]),
  );
}
