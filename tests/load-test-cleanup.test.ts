import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  customerSchema,
  examSchema,
  fittingSchema,
  followupSchema,
  repairSchema,
} from '../server/domain';
import { buildListQuery } from '../server/read-model';
import {
  seedRows,
  seedSQL,
  seedCounts,
  seedCountSQL,
  seedOptions,
  estimatedSeedWrites,
  seedTables,
} from './fixtures/retired-load-data.mjs';

let db: DatabaseSync;
const options = { storeId: 'load-store', count: 10000, date: '2026-10-01' };
function store(id = options.storeId) {
  db.prepare('INSERT INTO stores(id,name) VALUES(?,?)').run(id, '测试门店');
  db.prepare(
    "INSERT INTO store_memberships(email,tenant_id,name,source) VALUES(?,?,?,'managed')",
  ).run('owner@example.com', id, '店主');
}
function seed(start = 1, end = options.count, o = options) {
  for (const sql of seedSQL(o, start, end)) db.exec(sql);
}
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations-production')
    .filter((file) => file.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(`migrations-production/${file}`, 'utf8'));
  store();
});
afterEach(() => db.close());

const cleanupSQL = readFileSync('maintenance/2026-10-load-test-cleanup.sql', 'utf8');
const verifySQL = readFileSync('maintenance/2026-10-load-test-verify.sql', 'utf8');
function insertRow(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
  ).run(...(Object.values(row) as any[]));
}

describe('正式运营的一次性清理', () => {
  it('已物理清理测试客户的审计也能收尾，普通审计和其他店的错误引用保持不变', () => {
    const customer = seedRows(options, 1, 1).customers[0];
    const audit = { tenant_id: options.storeId, actor: 'owner@example.com', action: 'update' };
    insertRow('audit', { ...audit, id: 'orphan-fixture', customer_id: customer.id });
    insertRow('audit', { ...audit, id: 'ordinary-orphan', customer_id: 'ordinary-missing-id' });
    insertRow('audit', { ...audit, id: 'account-audit', customer_id: null });
    const conflict = seedRows(options, 2, 2).customers[0];
    insertRow('customers', { ...conflict, tenant_id: 'other-store' });
    insertRow('audit', { ...audit, id: 'conflicting-parent', customer_id: conflict.id });
    db.exec(cleanupSQL);
    expect(db.prepare("SELECT id FROM audit WHERE id='orphan-fixture'").get()).toBeUndefined();
    expect(db.prepare('SELECT id FROM audit ORDER BY id').all()).toEqual([
      { id: 'account-audit' },
      { id: 'conflicting-parent' },
      { id: 'ordinary-orphan' },
    ]);
    expect(db.prepare('SELECT id,tenant_id FROM customers').get()).toEqual({
      id: conflict.id,
      tenant_id: 'other-store',
    });
  });
  it.each([1000, 10000])(
    '清理 %i 名虚构客户和多店关联资料；真实资料、账户、门店及结构不变',
    (count) => {
      seed(1, count);
      const second = { ...options, storeId: "另一个's-store", count: 200 };
      store(second.storeId);
      seed(1, 200, second);
      const real = seedRows(options, 200, 200);
      for (const table of seedTables) {
        const row = { ...real[table][0], id: 'real-' + table };
        if (table !== 'customers') row.customer_id = 'real-customers';
        if (table === 'repairs') row.fitting_id = 'real-fittings';
        insertRow(table, row);
      }
      insertRow('audit', {
        id: 'real-audit',
        tenant_id: options.storeId,
        actor: 'owner@example.com',
        action: 'update',
        customer_id: 'real-customers',
      });
      const fictional = seedRows(options, 200, 200).customers[0];
      insertRow('audit', {
        id: 'test-audit',
        tenant_id: options.storeId,
        actor: 'owner@example.com',
        action: 'update',
        customer_id: fictional.id,
      });
      insertRow('accounts', {
        email: 'owner@example.com',
        tenant_id: options.storeId,
        name: '店主',
        store_name: '门店',
        source: 'config',
      });
      insertRow('sessions', {
        token: 'unchanged',
        role: '店主',
        tenant_id: options.storeId,
        expires_at: 2000000000000,
      });
      const protectedTables = [
        'accounts',
        'stores',
        'store_memberships',
        'sessions',
        'device_brands',
        'device_series',
        'device_models',
      ];
      const protectedRows = protectedTables.map((table) =>
        db.prepare(`SELECT * FROM ${table}`).all(),
      );
      const schema = db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
      // Editing or soft deleting fixtures does not hide them from cleanup.
      db.prepare("UPDATE customers SET name='已修改',deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(
        fictional.id,
      );
      db.exec(cleanupSQL);
      for (const [i, table] of protectedTables.entries())
        expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(protectedRows[i]);
      for (const table of seedTables)
        expect(db.prepare(`SELECT id FROM ${table}`).all()).toEqual([{ id: 'real-' + table }]);
      expect(db.prepare('SELECT id FROM audit').all()).toEqual([{ id: 'real-audit' }]);
      expect(Object.values(db.prepare(verifySQL).get()!)).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all()).toEqual(schema);
      db.exec(cleanupSQL);
      expect(db.prepare('SELECT id FROM customers').all()).toEqual([{ id: 'real-customers' }]);
    },
  );

  it('拒绝仅同名、相似前缀、错误门店编码、越界编号和额外版本；不级联删除手工资料或附件', () => {
    seed(1, 200);
    const original = seedRows(options, 1, 1).customers[0];
    const prefix = seedOptions(options).prefix;
    const protectedIds = [
      'real-customer',
      prefix + 'c-000000',
      prefix + 'c-050001',
      prefix + 'c-abc123',
      prefix + 'c-000001-extra',
      'loadtest-20260930-x-c-000001',
      'loadtest-20261001-wrong-store-c-000001',
    ];
    for (const id of protectedIds) insertRow('customers', { ...original, id });
    // An extra fitting version was never created by the retired importer.
    const fitting = seedRows(options, 20, 20).fittings[0];
    insertRow('fittings', { ...fitting, id: prefix + 'f-000020-3' });
    const repair = seedRows(options, 200, 200).repairs[0];
    insertRow('repairs', { ...repair, id: 'manual-repair' });
    const attachmentCustomer = seedRows(options, 2, 2).customers[0];
    insertRow('attachments', {
      id: 'manual-report',
      tenant_id: options.storeId,
      customer_id: attachmentCustomer.id,
      name: '保留文件',
      mime: 'application/pdf',
      size: 1,
      object_key: 'unchanged-private-object',
    });
    const attachments = db.prepare('SELECT * FROM attachments').all();
    db.exec(cleanupSQL);
    for (const id of protectedIds)
      expect(db.prepare('SELECT id FROM customers WHERE id=?').get(id)?.id).toBe(id);
    expect(db.prepare('SELECT * FROM attachments').all()).toEqual(attachments);
    expect(db.prepare("SELECT id FROM repairs WHERE id='manual-repair'").get()?.id).toBe(
      'manual-repair',
    );
    expect(db.prepare('SELECT id FROM fittings WHERE id=?').get(repair.fitting_id)?.id).toBe(
      repair.fitting_id,
    );
    for (const n of [2, 20, 200])
      expect(
        db
          .prepare('SELECT id FROM customers WHERE id=?')
          .get(seedRows(options, n, n).customers[0].id),
      ).toBeTruthy();
    expect(Number(db.prepare(verifySQL).get()?.customers_remaining)).toBeGreaterThan(0);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('部分执行后可安全续做；空正式数据库不会生成任何业务数据', () => {
    const statements = cleanupSQL
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    db.exec(cleanupSQL);
    expect(Object.values(db.prepare(verifySQL).get()!)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    seed(1, 1000);
    db.exec(statements.slice(0, 2).join(';') + ';');
    db.exec(cleanupSQL);
    db.exec(cleanupSQL);
    expect(Object.values(db.prepare(verifySQL).get()!)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const plan = db
      .prepare('EXPLAIN QUERY PLAN ' + statements.at(-1))
      .all()
      .map((row) => String(row.detail))
      .join('\n');
    expect(plan).toContain('sqlite_autoindex_customers_1');
    expect(plan).not.toMatch(/CORRELATED.*SUBQUERY/);
  });
});

describe('退役压测数据的内存兼容回归', () => {
  it('creates 10000 valid fictional profiles and linked business records; each SQL stays below D1 limits', () => {
    const rows = seedRows(options, 1, options.count);
    for (const row of rows.customers) {
      expect(
        customerSchema.safeParse({
          ...row,
          birthDate: row.birth_date,
          contactPhone: row.contact_phone,
        }).success,
      ).toBe(true);
      expect(row.name.startsWith('压测客户')).toBe(true);
      expect(row.phone.startsWith('TEST-')).toBe(true);
    }
    for (const row of rows.fittings)
      expect(fittingSchema.safeParse(JSON.parse(row.data)).success).toBe(true);
    for (const row of rows.exams)
      expect(examSchema.safeParse(JSON.parse(row.data)).success).toBe(true);
    for (const row of rows.followups) expect(followupSchema.safeParse(row).success).toBe(true);
    for (const row of rows.repairs)
      expect(
        repairSchema.safeParse({
          fittingId: row.fitting_id,
          occurredDate: row.occurred_date,
          receivedDate: row.received_date,
          completedDate: row.completed_date,
          status: row.status,
          problem: row.problem,
          findings: row.findings,
          workDone: row.work_done,
          parts: row.parts,
          price: row.price,
          warrantyCovered: Boolean(row.warranty_covered),
          notes: row.notes,
        }).success,
      ).toBe(true);
    const sql = seedSQL(options, 1, options.count);
    expect(sql.every((statement: string) => Buffer.byteLength(statement) < 90000)).toBe(true);
    seed();
    expect({ ...db.prepare(seedCountSQL(options)).get() }).toEqual({
      customers: 10000,
      fittings: 550,
      exams: 100,
      followups: 250,
      repairs: 50,
    });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const list = buildListQuery(
      'customers',
      options.storeId,
      { paged: '1', limit: '50', q: '压测客户010000' },
      options.date,
    );
    const result = db.prepare(list.sql).all(...list.values);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('压测客户010000');
  });

  it('counts arbitrary batch boundaries accurately and matches the current index write estimate', () => {
    expect(seedCounts(991, 1097)).toEqual({
      customers: 107,
      fittings: 6,
      exams: 1,
      followups: 3,
      repairs: 1,
    });
    const counts = seedCounts(1, 10000);
    let expected = 0;
    for (const table of seedTables) {
      const indexes = db
        .prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name=?")
        .all(table);
      const active = indexes.filter(
        (i) => !String(i.sql).includes('WHERE deleted_at IS NOT NULL'),
      ).length;
      expected += counts[table] * (1 + active);
    }
    expect(expected).toBe(96850);
    expect(estimatedSeedWrites(counts)).toBe(expected);
    const plan = db
      .prepare('EXPLAIN QUERY PLAN ' + seedCountSQL(options, 1, 1000))
      .all()
      .map((r) => String(r.detail))
      .join('\n');
    for (const table of seedTables)
      expect(plan).toContain(`USING INDEX sqlite_autoindex_${table}_1 (id>? AND id<?)`);
    expect(plan).not.toMatch(/SCAN (customers|fittings|exams|followups|repairs)/);
  });

  it('repeated imports preserve edits and soft deletion, and never recreate or move accounts/memberships', () => {
    seed(1, 1000);
    const customer = seedRows(options, 1000, 1000).customers[0];
    db.prepare(
      "UPDATE customers SET name='手工修改',deleted_at='2026-10-01 00:00:00' WHERE id=?",
    ).run(customer.id);
    const beforeAccounts = db.prepare('SELECT * FROM accounts').all(),
      beforeMembers = db.prepare('SELECT * FROM store_memberships').all(),
      beforeStores = db.prepare('SELECT * FROM stores').all();
    seed(1, 1000);
    expect(db.prepare('SELECT name,deleted_at FROM customers WHERE id=?').get(customer.id)).toEqual(
      { name: '手工修改', deleted_at: '2026-10-01 00:00:00' },
    );
    expect(db.prepare('SELECT * FROM accounts').all()).toEqual(beforeAccounts);
    expect(db.prepare('SELECT * FROM store_memberships').all()).toEqual(beforeMembers);
    expect(db.prepare('SELECT * FROM stores').all()).toEqual(beforeStores);
    expect({ ...db.prepare(seedCountSQL(options, 1, 1000)).get() }).toEqual(seedCounts(1, 1000));
  });

  it.each(['deleted', 'abandoned', 'disabled'])(
    'rechecks the %s target store at insert time',
    (change) => {
      if (change === 'deleted')
        db.prepare("UPDATE stores SET deleted_at='2026-10-01 00:00:00'").run();
      if (change === 'abandoned')
        db.prepare("UPDATE stores SET abandoned_at='2026-10-01 00:00:00'").run();
      if (change === 'disabled') db.prepare('UPDATE store_memberships SET enabled=0').run();
      seed(1, 100);
      expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()?.n).toBe(0);
    },
  );

  it('does not attach seed children to a conflicting customer from another store', () => {
    store('other');
    const row = seedRows(options, 100, 100).customers[0];
    db.prepare(
      "INSERT INTO customers(id,tenant_id,name,gender,birth_date,phone,source,status) VALUES(?,'other','原客户','男','','','自然到店','待评估')",
    ).run(row.id);
    seed(100, 100);
    expect(db.prepare('SELECT COUNT(*) AS n FROM fittings').get()?.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM exams').get()?.n).toBe(0);
  });

  it('validates counts, dates, ranges and store IDs before producing SQL', () => {
    for (const count of [0, 99, 50001, 100.5, NaN])
      expect(() => seedOptions({ ...options, count })).toThrow();
    expect(() => seedOptions({ ...options, date: '2026-02-31' })).toThrow();
    expect(() => seedOptions({ ...options, storeId: '' })).toThrow();
    expect(() => seedSQL(options, 0, 10)).toThrow();
    expect(() => seedSQL(options, 20, 10)).toThrow();
  });
});
