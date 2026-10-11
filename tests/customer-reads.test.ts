import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { app } from '../server/index';

let db: DatabaseSync, env: any, cookie: string;
let standaloneQueries: string[], batches: { sql: string[]; rows: any[][] }[];
function statement(sql: string, args: any[] = []): any {
  return {
    sql,
    bind: (...values: any[]) => statement(sql, values),
    rows: () => db.prepare(sql).all(...args),
    first: async () => {
      standaloneQueries.push(sql);
      return db.prepare(sql).get(...args) || null;
    },
    all: async () => {
      standaloneQueries.push(sql);
      return { results: db.prepare(sql).all(...args) };
    },
    run: async () => ({ success: true, meta: db.prepare(sql).run(...args) }),
  };
}
function req(path: string) {
  return app.request('http://localhost/api' + path, { headers: { Cookie: cookie } }, env);
}
function customer(id: string, tenant = 'demo-store') {
  db.prepare(
    "INSERT INTO customers(id,tenant_id,name,gender,birth_date,phone,source,status) VALUES(?,?,'虚构客户','未填写','','','','待评估')",
  ).run(id, tenant);
}
function records(prefix: string, owner = 'customer-a', tenant = 'demo-store') {
  for (const table of ['exams', 'fittings'])
    db.prepare(
      `INSERT INTO ${table}(id,tenant_id,customer_id,date,data) VALUES(?,?,?,'2026-10-01',?)`,
    ).run(
      prefix + '-' + table,
      tenant,
      owner,
      JSON.stringify({ date: '2026-10-01', notes: prefix }),
    );
  db.prepare(
    "INSERT INTO followups(id,tenant_id,customer_id,due,type,note) VALUES(?,?,?,'2026-10-01','到店预约',?)",
  ).run(prefix + '-followups', tenant, owner, prefix);
  db.prepare(
    "INSERT INTO attachments(id,tenant_id,customer_id,name,mime,size,object_key) VALUES(?,?,?,'虚构报告.pdf','application/pdf',1,?)",
  ).run(prefix + '-attachments', tenant, owner, prefix);
  db.prepare(
    "INSERT INTO audit(id,tenant_id,customer_id,actor,action) VALUES(?,?,?,'测试','测试')",
  ).run(prefix + '-audit', tenant, owner);
  db.prepare(
    "INSERT INTO repairs(id,tenant_id,customer_id,fitting_id,occurred_date,status,problem) VALUES(?,?,?,?,'2026-10-01','待送修','虚构故障')",
  ).run(prefix + '-repairs', tenant, owner, prefix + '-fittings');
}
function markRemoved(prefix: string, days: number) {
  const timestamp = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  for (const table of ['exams', 'fittings', 'followups', 'attachments', 'repairs'])
    db.prepare(`UPDATE ${table} SET deleted_at=? WHERE id=?`).run(timestamp, prefix + '-' + table);
  // A deleted repair is recoverable only while its associated fitting is active.
  db.prepare("UPDATE repairs SET fitting_id='active-fittings' WHERE id=?").run(prefix + '-repairs');
}
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations-production')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    db.exec(readFileSync('migrations-production/' + file, 'utf8'));
  standaloneQueries = [];
  batches = [];
  env = {
    DEMO_MODE: 'true',
    DB: {
      prepare: statement,
      batch: async (statements: any[]) => {
        db.exec('BEGIN');
        try {
          const rows = statements.map((s) => s.rows());
          db.exec('COMMIT');
          batches.push({ sql: statements.map((s) => s.sql), rows });
          return rows.map((results) => ({ results }));
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  const login = await app.request(
    'http://localhost/api/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: '店主' }),
    },
    env,
  );
  cookie = login.headers.get('Set-Cookie')!.split(';')[0];
  expect((await req('/me')).status).toBe(200); // Complete first-login provisioning.
  customer('customer-a');
  customer('customer-b');
  customer('foreign-customer', 'foreign-store');
  records('active');
  records('other', 'customer-b');
  records('foreign', 'foreign-customer', 'foreign-store');
  records('removed');
  markRemoved('removed', 1);
  records('expired');
  markRemoved('expired', 31);
  standaloneQueries = [];
  batches = [];
});
afterEach(() => db.close());

describe('客户明细合并读取', () => {
  it('明细用一次批处理读取全部分区，保留字段、排序和完整历史', async () => {
    records('older');
    db.exec("UPDATE exams SET date='2025-01-01' WHERE id='older-exams'");
    db.exec("UPDATE fittings SET date='2025-01-01' WHERE id='older-fittings'");
    db.exec("UPDATE followups SET due='2025-01-01' WHERE id='older-followups'");
    const response = await req('/customers/customer-a/detail');
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    for (const table of ['exams', 'fittings', 'followups'])
      expect(body[table].map((row: any) => row.id)).toEqual(['active-' + table, 'older-' + table]);
    for (const table of ['attachments', 'repairs'])
      expect(body[table].map((row: any) => row.id).sort()).toEqual([
        'active-' + table,
        'older-' + table,
      ]);
    expect(body.exams[0].notes).toBe('active');
    expect(body.fittings[0].date).toBe('2026-10-01');
    expect(body.audit.map((row: any) => row.id).sort()).toEqual([
      'active-audit',
      'expired-audit',
      'older-audit',
      'removed-audit',
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0].rows).toHaveLength(7);
    // The only standalone reads are the demo session and current account/store.
    expect(standaloneQueries).toHaveLength(2);
    expect(standaloneQueries.every((sql) => !/FROM (customers|repairs)/.test(sql))).toBe(true);
  });

  it('恢复列表用一次批处理读取，排除过期资料并保留原响应字段', async () => {
    const response = await req('/customers/customer-a/removed');
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    for (const table of ['exams', 'fittings', 'followups', 'attachments', 'repairs'])
      expect(body[table].map((row: any) => row.id)).toEqual(['removed-' + table]);
    expect(body.exams[0].notes).toBe('removed');
    expect(body.attachments[0]).not.toHaveProperty('object_key');
    expect(body).not.toHaveProperty('audit');
    expect(batches).toHaveLength(1);
    expect(batches[0].rows).toHaveLength(6);
    expect(standaloneQueries).toHaveLength(2);
  });

  it.each(['detail', 'removed'])(
    '%s 缺失、已删除和其他门店档案返回 404 且不读取子记录',
    async (path) => {
      db.exec("UPDATE customers SET deleted_at=CURRENT_TIMESTAMP WHERE id='customer-a'");
      // Legacy malformed rows with the request's store but a foreign-store parent.
      records('mismatched-parent', 'foreign-customer', 'demo-store');
      for (const id of ['missing', 'customer-a', 'foreign-customer']) {
        const response = await req(`/customers/${id}/${path}`);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: '档案不存在' });
        expect(batches.at(-1)!.rows.every((rows) => rows.length === 0)).toBe(true);
      }
    },
  );

  it.each(['detail', 'removed'])('%s 排除错门店、错客户以及已删除设备的维修关联', async (path) => {
    db.prepare(
      "INSERT INTO fittings(id,tenant_id,customer_id,date,data) VALUES('wrong-tenant-fitting','foreign-store','customer-a','2026-10-01','{}')",
    ).run();
    for (const fitting of [
      'wrong-tenant-fitting',
      'foreign-fittings',
      'other-fittings',
      'removed-fittings',
    ]) {
      const repairId = 'invalid-' + fitting;
      db.prepare(
        "INSERT INTO repairs(id,tenant_id,customer_id,fitting_id,occurred_date,status,problem,deleted_at) VALUES(?,'demo-store','customer-a',?,'2026-10-01','待送修','虚构故障',?)",
      ).run(
        repairId,
        fitting,
        path === 'removed' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      );
    }
    const response = await req('/customers/customer-a/' + path);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.repairs.map((r: any) => r.id)).toEqual([
      path === 'detail' ? 'active-repairs' : 'removed-repairs',
    ]);
  });

  it.each(['detail', 'removed'])(
    '%s 每次请求重查成员权限，退出门店后不能读取明细',
    async (path) => {
      db.exec("UPDATE store_memberships SET enabled=0 WHERE email='owner@demo.invalid'");
      const response = await req('/customers/customer-a/' + path);
      expect(response.status).toBe(403);
      expect(batches).toHaveLength(0);
    },
  );
});
