import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import {
  customerSchema,
  examSchema,
  fittingSchema,
  followupSchema,
  repairSchema,
  canWrite,
} from './domain';
import { purgeExpiredRecords, retentionCutoff } from './retention';
import { isLocalDemo } from './auth';
import { accountRoutes } from './accounts';
import { installHttpBoundary } from './http';
import { exportRoutes } from './exports';
import { attachmentRoutes } from './attachments';
import { installReadRoutes } from './read-model';
import type { Env, AppContext } from './types';
import {
  activeCustomerWrite,
  activeFittingWrite,
  activeStoreWrite,
  auditAfterWrite,
  commitWrite,
  WriteConflictError,
} from './mutations';
export const app = new Hono<AppContext>();
const id = () => crypto.randomUUID();
installHttpBoundary(app);
app.get('/api/config', (c) => c.json({ demo: isLocalDemo(c.env, c.req.url) }));
app.get('/api/auth/start', (c) => c.redirect('/'));
app.post('/api/login', async (c) => {
  const parsed = z.object({ role: z.literal('店主') }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '仅支持店主登录' }, 400);
  const data = parsed.data;
  const token = id() + id();
  await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()).run();
  await c.env.DB.prepare('INSERT INTO sessions VALUES(?,?,?,?)')
    .bind(token, data.role, 'demo-store', Date.now() + 86400000)
    .run();
  setCookie(c, 'hearing_session', token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: 86400,
  });
  return c.json({ role: data.role });
});
app.get('/api/me', (c) => c.json({ ...c.get('session'), demo: isLocalDemo(c.env, c.req.url) }));
app.post('/api/logout', async (c) => {
  deleteCookie(c, 'hearing_store', { path: '/' });
  if (!isLocalDemo(c.env, c.req.url))
    return c.json({ ok: true, logoutUrl: '/cdn-cgi/access/logout' });
  await c.env.DB.prepare('DELETE FROM sessions WHERE token=?')
    .bind(getCookie(c, 'hearing_session') || '')
    .run();
  deleteCookie(c, 'hearing_session', { path: '/' });
  return c.json({ ok: true });
});
app.route('/api/accounts', accountRoutes);
installReadRoutes(app);
const mapCustomer = (r: any) => ({ ...r, birthDate: r.birth_date, contactPhone: r.contact_phone });
app.get('/api/search', async (c) => {
  const query = (c.req.query('q') || '').trim();
  if (!query) return c.json([]);
  const pattern = `%${query.replace(/[!%_]/g, (char) => `!${char}`)}%`;
  if (new TextEncoder().encode(pattern).length > 50)
    return c.json({ error: '搜索关键词过长，请缩短后重试' }, 400);
  const rows = await c.env.DB.prepare(
    `
    SELECT c.* FROM customers c
    WHERE c.tenant_id=? AND c.deleted_at IS NULL AND (
      c.name LIKE ? ESCAPE '!' OR c.phone LIKE ? ESCAPE '!' OR
      c.contact LIKE ? ESCAPE '!' OR c.contact_phone LIKE ? ESCAPE '!' OR
      c.address LIKE ? ESCAPE '!' OR c.source LIKE ? ESCAPE '!' OR
      c.history LIKE ? ESCAPE '!' OR c.needs LIKE ? ESCAPE '!' OR
      EXISTS (SELECT 1 FROM exams e WHERE e.customer_id=c.id AND e.tenant_id=c.tenant_id AND e.deleted_at IS NULL AND
        (json_extract(e.data,'$.speech') LIKE ? ESCAPE '!' OR json_extract(e.data,'$.other') LIKE ? ESCAPE '!' OR json_extract(e.data,'$.conclusion') LIKE ? ESCAPE '!')) OR
      EXISTS (SELECT 1 FROM fittings f WHERE f.customer_id=c.id AND f.tenant_id=c.tenant_id AND f.deleted_at IS NULL AND
        (json_extract(f.data,'$.brand') LIKE ? ESCAPE '!' OR json_extract(f.data,'$.series') LIKE ? ESCAPE '!' OR json_extract(f.data,'$.model') LIKE ? ESCAPE '!' OR json_extract(f.data,'$.serial') LIKE ? ESCAPE '!' OR json_extract(f.data,'$.notes') LIKE ? ESCAPE '!')) OR
      EXISTS (SELECT 1 FROM followups u WHERE u.customer_id=c.id AND u.tenant_id=c.tenant_id AND u.deleted_at IS NULL AND
        (u.type LIKE ? ESCAPE '!' OR u.note LIKE ? ESCAPE '!' OR u.result LIKE ? ESCAPE '!')) OR
      EXISTS (SELECT 1 FROM repairs r JOIN fittings rf ON rf.id=r.fitting_id AND rf.deleted_at IS NULL
        WHERE r.customer_id=c.id AND r.tenant_id=c.tenant_id AND r.deleted_at IS NULL AND
        (r.problem LIKE ? ESCAPE '!' OR r.findings LIKE ? ESCAPE '!' OR r.work_done LIKE ? ESCAPE '!' OR
         r.parts LIKE ? ESCAPE '!' OR r.notes LIKE ? ESCAPE '!' OR r.status LIKE ? ESCAPE '!'))
    )
    ORDER BY CASE WHEN c.name LIKE ? ESCAPE '!' THEN 0 WHEN c.phone LIKE ? ESCAPE '!' THEN 1 ELSE 2 END,
      c.created_at DESC LIMIT 50
  `,
  )
    .bind(c.get('session').tenant_id, ...Array(27).fill(pattern))
    .all();
  return c.json(rows.results.map(mapCustomer));
});
app.post('/api/customers', async (c) => {
  const p = customerSchema.safeParse(await c.req.json());
  if (!p.success) return c.json({ error: '请填写客户姓名，并检查已填写的日期和资料' }, 400);
  const s = c.get('session'),
    d = p.data,
    key = id();
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `INSERT INTO customers(id,tenant_id,name,gender,birth_date,phone,contact,contact_phone,address,source,status,history,needs)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${activeStoreWrite} RETURNING id`,
    ).bind(
      key,
      s.tenant_id,
      d.name,
      d.gender,
      d.birthDate,
      d.phone,
      d.contact,
      d.contactPhone,
      d.address,
      d.source,
      d.status,
      d.history,
      d.needs,
      s.tenant_id,
      s.email,
    ),
    '创建客户档案',
    key,
  );
  return c.json({ id: key }, 201);
});
app.post('/api/intakes', async (c) => {
  const parsed = z
    .object({
      customer: customerSchema,
      exam: examSchema.optional(),
      fitting: fittingSchema.optional(),
      followup: followupSchema.optional(),
    })
    .safeParse(await c.req.json());
  if (!parsed.success)
    return c.json(
      {
        error: parsed.error.issues.some((issue) => issue.path[0] === 'fitting')
          ? '请检查验配日期、金额及已填写的序列号'
          : '请检查客户姓名及已填写的资料',
      },
      400,
    );
  const s = c.get('session'),
    d = parsed.data;
  if ((d.exam || d.fitting) && !canWrite(s.role, 'exam'))
    return c.json({ error: '当前角色无权录入听力检查和验配' }, 403);
  const fitting = d.fitting;
  const customerId = id(),
    p = d.customer;
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO customers(id,tenant_id,name,gender,birth_date,phone,contact,contact_phone,address,source,status,history,needs)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${activeStoreWrite} RETURNING id`,
    ).bind(
      customerId,
      s.tenant_id,
      p.name,
      p.gender,
      p.birthDate,
      p.phone,
      p.contact,
      p.contactPhone,
      p.address,
      p.source,
      p.status,
      p.history,
      p.needs,
      s.tenant_id,
      s.email,
    ),
    auditAfterWrite(c.env.DB, s, '创建客户档案', customerId),
  ];
  if (d.exam) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO exams(id,tenant_id,customer_id,date,data) SELECT ?,?,?,?,? WHERE ${activeCustomerWrite}`,
      ).bind(
        id(),
        s.tenant_id,
        customerId,
        d.exam.date,
        JSON.stringify(d.exam),
        customerId,
        s.tenant_id,
        s.email,
      ),
    );
    statements.push(auditAfterWrite(c.env.DB, s, '建档时录入听力检查', customerId));
  }
  if (fitting) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO fittings(id,tenant_id,customer_id,date,data) SELECT ?,?,?,?,? WHERE ${activeCustomerWrite}`,
      ).bind(
        id(),
        s.tenant_id,
        customerId,
        fitting.date,
        JSON.stringify(fitting),
        customerId,
        s.tenant_id,
        s.email,
      ),
    );
    statements.push(auditAfterWrite(c.env.DB, s, '建档时录入验配', customerId));
  }
  if (d.followup) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO followups(id,tenant_id,customer_id,due,type,note) SELECT ?,?,?,?,?,? WHERE ${activeCustomerWrite}`,
      ).bind(
        id(),
        s.tenant_id,
        customerId,
        d.followup.due,
        d.followup.type,
        d.followup.note,
        customerId,
        s.tenant_id,
        s.email,
      ),
      auditAfterWrite(c.env.DB, s, '建档时安排随访', customerId),
    );
  }
  const [created] = await c.env.DB.batch(statements);
  if (!created.results.length) throw new WriteConflictError();
  return c.json({ id: customerId }, 201);
});
app.delete('/api/customers/:id', async (c) => {
  const s = c.get('session'),
    key = c.req.param('id');
  if (s.role !== '店主') return c.json({ error: '只有店主可以删除客户档案' }, 403);
  const row = await c.env.DB.prepare(
    'SELECT id FROM customers WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
  )
    .bind(key, s.tenant_id)
    .first();
  if (!row) return c.json({ error: '档案不存在或已删除' }, 404);
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `UPDATE customers SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=? AND deleted_at IS NULL
       AND ${activeStoreWrite} RETURNING id`,
    ).bind(key, s.tenant_id, s.tenant_id, s.email),
    '删除客户档案',
    key,
  );
  return c.json({ ok: true });
});
app.post('/api/customers/:id/restore', async (c) => {
  const s = c.get('session'),
    key = c.req.param('id');
  if (s.role !== '店主') return c.json({ error: '只有店主可以恢复客户档案' }, 403);
  const row = await c.env.DB.prepare(
    'SELECT id FROM customers WHERE id=? AND tenant_id=? AND deleted_at IS NOT NULL AND deleted_at>?',
  )
    .bind(key, s.tenant_id, retentionCutoff())
    .first();
  if (!row) return c.json({ error: '已删除档案不存在' }, 404);
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `UPDATE customers SET deleted_at=NULL WHERE id=? AND tenant_id=? AND deleted_at>datetime('now','-30 days')
       AND ${activeStoreWrite} RETURNING id`,
    ).bind(key, s.tenant_id, s.tenant_id, s.email),
    '恢复客户档案',
    key,
  );
  return c.json({ ok: true });
});
app.use('/api/customers/:id/*', async (c, next) => {
  const r = await c.env.DB.prepare(
    'SELECT id FROM customers WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
  )
    .bind(c.req.param('id'), c.get('session').tenant_id)
    .first();
  if (!r) return c.json({ error: '档案不存在' }, 404);
  await next();
});
app.get('/api/customers/:id/detail', async (c) => {
  const t = c.get('session').tenant_id,
    k = c.req.param('id');
  const result = await c.env.DB.batch(
    ['exams', 'fittings', 'followups', 'attachments', 'audit'].map((table) =>
      c.env.DB.prepare(
        `SELECT * FROM ${table} WHERE tenant_id=? AND customer_id=? ${['exams', 'fittings', 'followups', 'attachments'].includes(table) ? 'AND deleted_at IS NULL' : ''} ORDER BY ${table === 'followups' ? 'due' : ['exams', 'fittings'].includes(table) ? 'date DESC, created_at' : 'created_at'} DESC`,
      ).bind(t, k),
    ),
  );
  const repairs = await c.env.DB.prepare(
    `SELECT r.* FROM repairs r JOIN fittings f ON f.id=r.fitting_id AND f.tenant_id=r.tenant_id AND f.deleted_at IS NULL
     WHERE r.tenant_id=? AND r.customer_id=? AND r.deleted_at IS NULL ORDER BY r.occurred_date DESC,r.created_at DESC`,
  )
    .bind(t, k)
    .all();
  return c.json({
    ...Object.fromEntries(
      ['exams', 'fittings', 'followups', 'attachments', 'audit'].map((table, i) => [
        table,
        result[i].results.map((r: any) => (r.data ? { ...r, ...JSON.parse(r.data) } : r)),
      ]),
    ),
    repairs: repairs.results,
  });
});
app.put('/api/customers/:id/profile', async (c) => {
  const p = customerSchema.safeParse(await c.req.json());
  if (!p.success) return c.json({ error: '请填写客户姓名，并检查已填写的资料' }, 400);
  const d = p.data,
    s = c.get('session'),
    k = c.req.param('id');
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `UPDATE customers SET name=?,gender=?,birth_date=?,phone=?,contact=?,contact_phone=?,address=?,source=?,status=?,history=?,needs=?
       WHERE id=? AND tenant_id=? AND deleted_at IS NULL AND ${activeStoreWrite} RETURNING id`,
    ).bind(
      d.name,
      d.gender,
      d.birthDate,
      d.phone,
      d.contact,
      d.contactPhone,
      d.address,
      d.source,
      d.status,
      d.history,
      d.needs,
      k,
      s.tenant_id,
      s.tenant_id,
      s.email,
    ),
    '更新客户档案',
    k,
  );
  return c.json({ ok: true });
});
for (const [path, schema, resource, label] of [
  ['exams', examSchema, 'exam', '新增听力检查'],
  ['fittings', fittingSchema, 'fitting', '新增验配记录'],
  ['followups', followupSchema, 'followup', '安排随访'],
] as const) {
  app.post(`/api/customers/:id/${path}`, async (c) => {
    const s = c.get('session');
    if (!canWrite(s.role, resource)) return c.json({ error: '当前角色无权填写专业验配记录' }, 403);
    const p = schema.safeParse(await c.req.json());
    if (!p.success)
      return c.json(
        {
          error:
            path === 'fittings'
              ? '请检查验配日期、金额及已填写的序列号'
              : '记录格式不正确，请检查日期及听阈范围',
        },
        400,
      );
    const d: any = p.data,
      k = id(),
      customer = c.req.param('id');
    const statement =
      path === 'followups'
        ? c.env.DB.prepare(
            `INSERT INTO followups(id,tenant_id,customer_id,due,type,note) SELECT ?,?,?,?,?,?
             WHERE ${activeCustomerWrite} RETURNING id`,
          ).bind(k, s.tenant_id, customer, d.due, d.type, d.note, customer, s.tenant_id, s.email)
        : c.env.DB.prepare(
            `INSERT INTO ${path}(id,tenant_id,customer_id,date,data) SELECT ?,?,?,?,?
             WHERE ${activeCustomerWrite} RETURNING id`,
          ).bind(
            k,
            s.tenant_id,
            customer,
            d.date,
            JSON.stringify(d),
            customer,
            s.tenant_id,
            s.email,
          );
    await commitWrite(c.env.DB, s, statement, label, customer);
    return c.json({ id: k }, 201);
  });
}
for (const [kind, schema, resource, label] of [
  ['exams', examSchema, 'exam', '修改听力检查记录'],
  ['fittings', fittingSchema, 'fitting', '修改验配记录'],
] as const) {
  app.put(`/api/customers/:id/${kind}/:recordId`, async (c) => {
    const s = c.get('session'),
      customer = c.req.param('id'),
      record = c.req.param('recordId');
    if (!canWrite(s.role, resource)) return c.json({ error: '当前角色无权修改专业记录' }, 403);
    const parsed = schema.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json(
        {
          error:
            kind === 'fittings'
              ? '请检查验配日期、金额及已填写的序列号'
              : '记录格式不正确，请检查日期及听阈范围',
        },
        400,
      );
    const existing = await c.env.DB.prepare(
      `SELECT data FROM ${kind} WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NULL`,
    )
      .bind(record, customer, s.tenant_id)
      .first<{ data: string }>();
    if (!existing) return c.json({ error: '记录不存在或已删除' }, 404);
    const data: any = parsed.data;
    await commitWrite(
      c.env.DB,
      s,
      c.env.DB.prepare(
        `UPDATE ${kind} SET date=?,data=? WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NULL
         AND ${activeCustomerWrite} RETURNING id`,
      ).bind(
        data.date,
        JSON.stringify(data),
        record,
        customer,
        s.tenant_id,
        customer,
        s.tenant_id,
        s.email,
      ),
      label,
      customer,
    );
    return c.json({ ok: true });
  });
}
for (const method of ['post', 'put'] as const) {
  app[method](
    method === 'post' ? '/api/customers/:id/repairs' : '/api/customers/:id/repairs/:recordId',
    async (c) => {
      const s = c.get('session'),
        customer = c.req.param('id');
      if (!canWrite(s.role, 'repair')) return c.json({ error: '当前角色无权登记维修' }, 403);
      const parsed = repairSchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ error: '请检查关联设备、维修日期和费用' }, 400);
      const d = parsed.data;
      const fitting = await c.env.DB.prepare(
        'SELECT id FROM fittings WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NULL',
      )
        .bind(d.fittingId, customer, s.tenant_id)
        .first();
      if (!fitting) return c.json({ error: '所选验配设备不存在或已删除' }, 400);
      const recordId = method === 'post' ? id() : c.req.param('recordId');
      if (method === 'put') {
        const existing = await c.env.DB.prepare(
          'SELECT id FROM repairs WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NULL',
        )
          .bind(recordId, customer, s.tenant_id)
          .first();
        if (!existing) return c.json({ error: '维修记录不存在或已删除' }, 404);
      }
      const values = [
        d.fittingId,
        d.occurredDate,
        d.receivedDate,
        d.completedDate,
        d.status,
        d.problem,
        d.findings,
        d.workDone,
        d.parts,
        d.price,
        Number(d.warrantyCovered),
        d.notes,
      ];
      await commitWrite(
        c.env.DB,
        s,
        method === 'post'
          ? c.env.DB.prepare(
              `INSERT INTO repairs(id,tenant_id,customer_id,fitting_id,occurred_date,received_date,completed_date,status,problem,findings,work_done,parts,price,warranty_covered,notes)
             SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${activeCustomerWrite} AND ${activeFittingWrite} RETURNING id`,
            ).bind(
              recordId,
              s.tenant_id,
              customer,
              ...values,
              customer,
              s.tenant_id,
              s.email,
              d.fittingId,
              customer,
              s.tenant_id,
            )
          : c.env.DB.prepare(
              `UPDATE repairs SET fitting_id=?,occurred_date=?,received_date=?,completed_date=?,status=?,problem=?,findings=?,work_done=?,parts=?,price=?,warranty_covered=?,notes=?
             WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NULL
               AND ${activeCustomerWrite} AND ${activeFittingWrite} RETURNING id`,
            ).bind(
              ...values,
              recordId,
              customer,
              s.tenant_id,
              customer,
              s.tenant_id,
              s.email,
              d.fittingId,
              customer,
              s.tenant_id,
            ),
        method === 'post' ? '新增维修记录' : '修改维修记录',
        customer,
      );
      return c.json(
        method === 'post' ? { id: recordId } : { ok: true },
        method === 'post' ? 201 : 200,
      );
    },
  );
}
app.put('/api/customers/:id/followups/:recordId', async (c) => {
  const s = c.get('session'),
    customer = c.req.param('id'),
    record = c.req.param('recordId');
  if (!canWrite(s.role, 'followup')) return c.json({ error: '当前角色无权修改随访' }, 403);
  const parsed = followupSchema
    .extend({ result: z.string().max(3000).optional() })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '请检查随访日期和已填写的内容' }, 400);
  const existing = await c.env.DB.prepare(
    'SELECT completed FROM followups WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NULL',
  )
    .bind(record, customer, s.tenant_id)
    .first<{ completed: number }>();
  if (!existing) return c.json({ error: '随访不存在或已删除' }, 404);
  if (existing.completed && !parsed.data.result?.trim())
    return c.json({ error: '已完成随访须保留联系结果' }, 400);
  const d = parsed.data;
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `UPDATE followups SET due=?,type=?,note=?,result=CASE WHEN completed=1 THEN ? ELSE result END
       WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NULL AND ${activeCustomerWrite}
         AND (completed=0 OR length(trim(?))>0) RETURNING id`,
    ).bind(
      d.due,
      d.type,
      d.note,
      d.result || '',
      record,
      customer,
      s.tenant_id,
      customer,
      s.tenant_id,
      s.email,
      d.result || '',
    ),
    '修改随访记录',
    customer,
  );
  return c.json({ ok: true });
});
app.get('/api/customers/:id/removed', async (c) => {
  const tenant = c.get('session').tenant_id,
    customer = c.req.param('id');
  const [exams, fittings, followups, attachments, repairs] = await c.env.DB.batch([
    c.env.DB.prepare(
      'SELECT id,date,data,deleted_at FROM exams WHERE tenant_id=? AND customer_id=? AND deleted_at IS NOT NULL AND deleted_at>? ORDER BY deleted_at DESC',
    ).bind(tenant, customer, retentionCutoff()),
    c.env.DB.prepare(
      'SELECT id,date,data,deleted_at FROM fittings WHERE tenant_id=? AND customer_id=? AND deleted_at IS NOT NULL AND deleted_at>? ORDER BY deleted_at DESC',
    ).bind(tenant, customer, retentionCutoff()),
    c.env.DB.prepare(
      'SELECT * FROM followups WHERE tenant_id=? AND customer_id=? AND deleted_at IS NOT NULL AND deleted_at>? ORDER BY deleted_at DESC',
    ).bind(tenant, customer, retentionCutoff()),
    c.env.DB.prepare(
      'SELECT id,name,size,created_at,deleted_at FROM attachments WHERE tenant_id=? AND customer_id=? AND deleted_at IS NOT NULL AND deleted_at>? ORDER BY deleted_at DESC',
    ).bind(tenant, customer, retentionCutoff()),
    c.env.DB.prepare(
      `SELECT r.* FROM repairs r JOIN fittings f ON f.id=r.fitting_id AND f.deleted_at IS NULL
       WHERE r.tenant_id=? AND r.customer_id=? AND r.deleted_at IS NOT NULL AND r.deleted_at>? ORDER BY r.deleted_at DESC`,
    ).bind(tenant, customer, retentionCutoff()),
  ]);
  return c.json({
    exams: exams.results.map((r: any) => ({ ...r, ...JSON.parse(r.data) })),
    fittings: fittings.results.map((r: any) => ({ ...r, ...JSON.parse(r.data) })),
    followups: followups.results,
    attachments: attachments.results,
    repairs: repairs.results,
  });
});
for (const kind of ['exams', 'fittings', 'followups', 'repairs'] as const) {
  app.delete(`/api/customers/:id/${kind}/:recordId`, async (c) => {
    const s = c.get('session'),
      customer = c.req.param('id'),
      record = c.req.param('recordId');
    if (
      !canWrite(
        s.role,
        kind === 'exams'
          ? 'exam'
          : kind === 'fittings'
            ? 'fitting'
            : kind === 'repairs'
              ? 'repair'
              : 'followup',
      )
    )
      return c.json({ error: '当前角色无权删除专业记录' }, 403);
    const existing = await c.env.DB.prepare(
      `SELECT id FROM ${kind} WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NULL`,
    )
      .bind(record, customer, s.tenant_id)
      .first();
    if (!existing) return c.json({ error: '记录不存在或已删除' }, 404);
    await commitWrite(
      c.env.DB,
      s,
      c.env.DB.prepare(
        `UPDATE ${kind} SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND customer_id=? AND tenant_id=?
         AND deleted_at IS NULL AND ${activeCustomerWrite} RETURNING id`,
      ).bind(record, customer, s.tenant_id, customer, s.tenant_id, s.email),
      kind === 'exams'
        ? '删除听力检查记录'
        : kind === 'fittings'
          ? '删除验配记录'
          : kind === 'repairs'
            ? '删除维修记录'
            : '删除随访记录',
      customer,
    );
    return c.json({ ok: true });
  });
  app.post(`/api/customers/:id/${kind}/:recordId/restore`, async (c) => {
    const s = c.get('session'),
      customer = c.req.param('id'),
      record = c.req.param('recordId');
    if (
      !canWrite(
        s.role,
        kind === 'exams'
          ? 'exam'
          : kind === 'fittings'
            ? 'fitting'
            : kind === 'repairs'
              ? 'repair'
              : 'followup',
      )
    )
      return c.json({ error: '当前角色无权恢复专业记录' }, 403);
    const existing = await c.env.DB.prepare(
      `SELECT id FROM ${kind} WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at IS NOT NULL AND deleted_at>?`,
    )
      .bind(record, customer, s.tenant_id, retentionCutoff())
      .first();
    if (!existing) return c.json({ error: '已删除记录不存在' }, 404);
    if (kind === 'repairs') {
      const fitting = await c.env.DB.prepare(
        'SELECT f.id FROM repairs r JOIN fittings f ON f.id=r.fitting_id AND f.deleted_at IS NULL WHERE r.id=? AND r.customer_id=? AND r.tenant_id=?',
      )
        .bind(record, customer, s.tenant_id)
        .first();
      if (!fitting) return c.json({ error: '请先恢复关联的验配记录' }, 400);
    }
    await commitWrite(
      c.env.DB,
      s,
      c.env.DB.prepare(
        `UPDATE ${kind} SET deleted_at=NULL WHERE id=? AND customer_id=? AND tenant_id=? AND deleted_at>datetime('now','-30 days')
         AND ${activeCustomerWrite}
         ${kind === 'repairs' ? 'AND EXISTS(SELECT 1 FROM fittings f WHERE f.id=repairs.fitting_id AND f.tenant_id=repairs.tenant_id AND f.customer_id=repairs.customer_id AND f.deleted_at IS NULL)' : ''} RETURNING id`,
      ).bind(record, customer, s.tenant_id, customer, s.tenant_id, s.email),
      kind === 'exams'
        ? '恢复听力检查记录'
        : kind === 'fittings'
          ? '恢复验配记录'
          : kind === 'repairs'
            ? '恢复维修记录'
            : '恢复随访记录',
      customer,
    );
    return c.json({ ok: true });
  });
}
app.put('/api/followups/:id', async (c) => {
  const parsed = z
    .object({ result: z.string().trim().min(1).max(3000) })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '请填写本次回访结果' }, 400);
  const d = parsed.data;
  const s = c.get('session');
  const r = await c.env.DB.prepare(
    'SELECT f.customer_id FROM followups f JOIN customers c ON c.id=f.customer_id AND c.tenant_id=f.tenant_id AND c.deleted_at IS NULL WHERE f.id=? AND f.tenant_id=? AND f.deleted_at IS NULL',
  )
    .bind(c.req.param('id'), s.tenant_id)
    .first<{ customer_id: string }>();
  if (!r) return c.json({ error: '记录不存在' }, 404);
  await commitWrite(
    c.env.DB,
    s,
    c.env.DB.prepare(
      `UPDATE followups SET completed=1,result=?,completed_at=CURRENT_TIMESTAMP
       WHERE id=? AND tenant_id=? AND deleted_at IS NULL AND ${activeCustomerWrite} RETURNING id`,
    ).bind(d.result, c.req.param('id'), s.tenant_id, r.customer_id, s.tenant_id, s.email),
    '完成随访',
    r.customer_id,
  );
  return c.json({ ok: true });
});
app.route('/api', attachmentRoutes);
app.route('/api/export', exportRoutes);
app.notFound((c) => c.json({ error: '接口不存在' }, 404));
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    await purgeExpiredRecords(env);
  },
} satisfies ExportedHandler<Env>;
