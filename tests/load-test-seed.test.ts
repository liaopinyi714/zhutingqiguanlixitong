import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
  seedCleanupSQL,
  estimatedSeedWrites,
  seedTables,
} from '../scripts/load-test-data.mjs';
import {
  requestedCount,
  seedLoadTest,
  targetStoreSQL,
  wranglerExecutor,
} from '../scripts/seed-load-test.mjs';

let db: DatabaseSync;
const options = { storeId: 'load-store', count: 10000, date: '2026-10-01' };
const config = {
  account_id: 'a'.repeat(32),
  preview_urls: false,
  vars: {
    DEMO_MODE: 'false',
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_AUD: 'b'.repeat(64),
  },
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'hearing-care-production',
      database_id: '11111111-1111-1111-1111-111111111111',
      migrations_dir: 'migrations-production',
    },
  ],
  r2_buckets: [{ binding: 'FILES', bucket_name: 'hearing-care-production-private' }],
};
function store(id = options.storeId) {
  db.prepare('INSERT INTO stores(id,name) VALUES(?,?)').run(id, '测试门店');
  db.prepare(
    "INSERT INTO store_memberships(email,tenant_id,name,source) VALUES(?,?,?,'managed')",
  ).run('owner@example.com', id, '店主');
}
function execute(sql: string, file = false): any {
  if (!file) return Promise.resolve(db.prepare(sql).all());
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return Promise.resolve([]);
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

describe('controlled load-test fixtures', () => {
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

  it('isolates datasets by store even with quoted IDs, and cleanup uses existing customer recovery', () => {
    const second = { ...options, storeId: "another's-store", count: 100 };
    store(second.storeId);
    seed(1, 100);
    seed(1, 100, second);
    db.prepare(
      "INSERT INTO customers(id,tenant_id,name,gender,birth_date,phone,source,status) VALUES('normal',?,'已有客户','男','','','自然到店','待评估')",
    ).run(options.storeId);
    expect(seedRows(options, 1, 1).customers[0].id).not.toBe(
      seedRows(second, 1, 1).customers[0].id,
    );
    db.exec(seedCleanupSQL(options));
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM customers WHERE tenant_id=? AND deleted_at IS NULL')
        .get(options.storeId)?.n,
    ).toBe(1);
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM customers WHERE tenant_id=? AND deleted_at IS NULL')
        .get(second.storeId)?.n,
    ).toBe(100);
    expect(
      db.prepare("SELECT deleted_at FROM customers WHERE id='normal'").get()?.deleted_at,
    ).toBeNull();
    seed(1, 100);
    expect(
      db
        .prepare('SELECT COUNT(*) AS n FROM customers WHERE tenant_id=? AND deleted_at IS NULL')
        .get(options.storeId)?.n,
    ).toBe(1);
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

describe('Cloudflare Builds seed workflow', () => {
  const env = { LOAD_TEST_CUSTOMERS: '2000', WORKERS_CI: '1', WORKERS_CI_BRANCH: 'main' };
  const log = () => {};
  it('is off by default with no config requirement or database access', async () => {
    expect(
      await seedLoadTest({
        env: {},
        config: undefined,
        execute: () => {
          throw new Error('unexpected');
        },
        log,
      }),
    ).toEqual({ status: 'disabled' });
    for (const setting of ['', '0'])
      expect(requestedCount({ LOAD_TEST_CUSTOMERS: setting })).toBe(0);
    for (const setting of ['true', '-1', '1e4', '10000.5', '999999'])
      expect(() => requestedCount({ LOAD_TEST_CUSTOMERS: setting })).toThrow();
  });
  it('rejects a preview build, invalid config and invalid explicit target before DB access', async () => {
    const run = (e: any, c: any = config) =>
      seedLoadTest({
        env: e,
        config: c,
        execute: () => {
          throw new Error('unexpected');
        },
        log,
      });
    await expect(run({ ...env, WORKERS_CI_BRANCH: 'preview' })).rejects.toThrow('main');
    await expect(run(env, {})).rejects.toThrow('正式配置');
    await expect(run({ ...env, LOAD_TEST_STORE_ID: ' ' })).rejects.toThrow('LOAD_TEST_STORE_ID');
  });
  it('defers an empty first deployment; refuses ambiguous or invalid targets', async () => {
    db.prepare('DELETE FROM store_memberships').run();
    db.prepare('DELETE FROM stores').run();
    expect(await seedLoadTest({ env, config, execute, log })).toEqual({ status: 'deferred' });
    store();
    store('other');
    await expect(seedLoadTest({ env, config, execute, log })).rejects.toThrow('多个门店');
    await expect(
      seedLoadTest({ env: { ...env, LOAD_TEST_STORE_ID: 'absent' }, config, execute, log }),
    ).rejects.toThrow('指定门店');
    expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()?.n).toBe(0);
    expect(db.prepare(targetStoreSQL(options.storeId)).all()).toHaveLength(1);
  });
  it('resumes after a failed chunk and skips verified chunks on later deployments', async () => {
    let imports = 0;
    await expect(
      seedLoadTest({
        env,
        config,
        log,
        execute: (sql: string, file: boolean) => {
          if (file && ++imports === 2) throw new Error('simulated quota exhausted');
          return execute(sql, file);
        },
      }),
    ).rejects.toThrow('quota');
    expect({ ...db.prepare(seedCountSQL({ ...options, count: 2000 })).get() }).toEqual(
      seedCounts(1, 1000),
    );
    const resumed = await seedLoadTest({ env, config, execute, log });
    expect(resumed.status).toBe('complete');
    expect(resumed.importedChunks).toBe(1);
    const repeated = await seedLoadTest({ env, config, execute, log });
    expect(repeated.importedChunks).toBe(0);
    expect(repeated.totals).toEqual(seedCounts(1, 2000));
  });

  it('resumes the already imported first 1000 rows despite file-import progress mixed with JSON', async () => {
    seed(1, 1000);
    let files = 0;
    const paths: string[] = [],
      messages: string[] = [];
    const adapter = wranglerExecutor('wrangler.jsonc', (_command: string, args: string[]) => {
      expect(args).toContain('--remote');
      expect(args).toContain('--json');
      if (args.includes('--file')) {
        const path = args[args.indexOf('--file') + 1];
        paths.push(path);
        files++;
        db.exec(readFileSync(path, 'utf8'));
        return {
          status: 0,
          stdout:
            '\u001b[32m│ Checking if file needs uploading\u001b[0m\n│ Uploading private-upload-url\n\n' +
            JSON.stringify([{ success: true, results: [{ 'Rows written': 9685 }] }]),
          stderr: '',
        };
      }
      const rows = db.prepare(args[args.indexOf('--command') + 1]).all();
      return { status: 0, stdout: JSON.stringify([{ success: true, results: rows }]), stderr: '' };
    });
    const result = await seedLoadTest({
      env,
      config,
      execute: adapter,
      log: (message: string) => messages.push(message),
    });
    expect(result.status).toBe('complete');
    expect(result.importedChunks).toBe(1);
    expect(result.totals).toEqual(seedCounts(1, 2000));
    expect(files).toBe(1);
    expect(paths.every((path) => !existsSync(path))).toBe(true);
    expect(messages.join('\n')).not.toContain('private-upload-url');
    expect((await seedLoadTest({ env, config, execute: adapter, log })).importedChunks).toBe(0);
    expect(files).toBe(1);
  });

  it('does not report an import as complete merely because the process exited successfully', async () => {
    const adapter = wranglerExecutor('wrangler.jsonc', (_command: string, args: string[]) => {
      const rows = args.includes('--file')
        ? []
        : db.prepare(args[args.indexOf('--command') + 1]).all();
      return {
        status: 0,
        stdout: args.includes('--file')
          ? 'Uploading complete.\n'
          : JSON.stringify([{ success: true, results: rows }]),
        stderr: '',
      };
    });
    await expect(seedLoadTest({ env, config, execute: adapter, log })).rejects.toThrow(
      '未完整写入',
    );
    expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()?.n).toBe(0);
  });

  it('still rejects malformed SELECT output and failed file imports without exposing raw output', async () => {
    const wrong = wranglerExecutor('wrangler.jsonc', () => ({
      status: 0,
      stdout: 'private malformed output',
      stderr: '',
    }));
    await expect(wrong('SELECT 1')).rejects.toThrow('返回格式异常');
    const failed = wranglerExecutor('wrangler.jsonc', () => ({
      status: 1,
      stdout: 'private account data',
      stderr: "Your account has exceeded D1's free tier daily row write limit.",
    }));
    await expect(failed('SELECT 1;', true)).rejects.toThrow('当天免费额度');
    const errored = wranglerExecutor('wrangler.jsonc', () => ({
      status: 0,
      stdout: JSON.stringify([{ success: false, results: [] }]),
      stderr: '',
    }));
    await expect(errored('SELECT 1')).rejects.toThrow('未确认');
  });
});
