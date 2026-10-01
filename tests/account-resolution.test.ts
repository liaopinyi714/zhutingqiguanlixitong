import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import {
  accountSnapshotQuery,
  resolveAccountRequest,
  resolveAccount,
  storesForAccount,
} from '../server/account-resolution';

let db: DatabaseSync, env: any, roundTrips: number, batches: number, inBatch: boolean;
let beforeBatch: (() => void) | undefined;
const owner = {
  email: 'owner@example.com',
  name: '店主',
  role: '店主',
  tenantId: 'initial',
  storeName: '初始门店',
};
function statement(sql: string, args: any[] = []): any {
  return {
    bind: (...values: any[]) => statement(sql, values),
    first: async () => {
      if (!inBatch) roundTrips++;
      return db.prepare(sql).get(...args) || null;
    },
    all: async () => {
      if (!inBatch) roundTrips++;
      return { results: db.prepare(sql).all(...args) };
    },
    run: async () => {
      if (!inBatch) roundTrips++;
      return { meta: db.prepare(sql).run(...args) };
    },
  };
}
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations-production')
    .filter((s) => s.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(`migrations-production/${file}`, 'utf8'));
  roundTrips = batches = 0;
  inBatch = false;
  beforeBatch = undefined;
  env = {
    STAFF_ACCOUNTS: JSON.stringify([owner]),
    DB: {
      prepare: statement,
      batch: async (statements: any[]) => {
        roundTrips++;
        batches++;
        beforeBatch?.();
        beforeBatch = undefined;
        db.exec('BEGIN');
        inBatch = true;
        try {
          const out = [];
          for (const s of statements) out.push(await s.all());
          db.exec('COMMIT');
          return out;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        } finally {
          inBatch = false;
        }
      },
    },
  };
});
afterEach(() => db.close());
async function initialize() {
  expect((await resolveAccount(env, owner.email)).tenant_id).toBe(owner.tenantId);
  roundTrips = batches = 0;
}
function store(id: string, created: string, own = true) {
  db.prepare('INSERT INTO stores(id,name,created_at) VALUES(?,?,?)').run(id, id + '门店', created);
  if (own)
    db.prepare(
      "INSERT INTO store_memberships(email,tenant_id,name,source) VALUES(?,?,?,'managed')",
    ).run(owner.email, id, owner.name);
}

describe('账户单次数据库解析', () => {
  it('首次引导为读取、一个事务、复读三次往返，随后每个请求重新读取一次', async () => {
    const first = await resolveAccount(env, owner.email);
    expect(roundTrips).toBe(3);
    expect(batches).toBe(1);
    roundTrips = batches = 0;
    expect(await resolveAccount(env, owner.email)).toEqual(first);
    expect(roundTrips).toBe(1);
    expect(batches).toBe(0);
    db.prepare('UPDATE accounts SET name=?,avatar=? WHERE email=?').run(
      '新姓名',
      'existing-avatar',
      owner.email,
    );
    db.prepare('UPDATE stores SET name=? WHERE id=?').run('新店名', owner.tenantId);
    const updated = await resolveAccount(env, owner.email);
    expect(updated).toMatchObject({
      name: '新姓名',
      avatar: 'existing-avatar',
      storeName: '新店名',
      actor: '新姓名 <owner@example.com>',
    });
    expect(roundTrips).toBe(2);
  });

  it.each(['disabled', 'left', 'deleted', 'expired'])(
    '%s 在下一次读取立即拒绝旧门店，账户独立存在且不重新引导',
    async (change) => {
      await initialize();
      if (change === 'disabled')
        db.prepare('UPDATE store_memberships SET enabled=0 WHERE email=?').run(owner.email);
      if (change === 'left')
        db.prepare(
          'UPDATE store_memberships SET enabled=0,left_at=CURRENT_TIMESTAMP WHERE email=?',
        ).run(owner.email);
      if (change === 'deleted')
        db.prepare('UPDATE stores SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(owner.tenantId);
      if (change === 'expired')
        db.prepare("UPDATE stores SET abandoned_at='2000-01-01 00:00:00' WHERE id=?").run(
          owner.tenantId,
        );
      await expect(resolveAccount(env, owner.email, false, owner.tenantId)).rejects.toMatchObject({
        status: 403,
      });
      expect((await resolveAccount(env, owner.email)).tenant_id).toBe('');
      expect(roundTrips).toBe(2);
      expect(batches).toBe(0);
    },
  );

  it('提供者撤权立即生效，数据库内的账户及成员行不能自行授予登录资格', async () => {
    await initialize();
    env.STAFF_ACCOUNTS = JSON.stringify([{ ...owner, email: 'another@example.com' }]);
    await expect(resolveAccount(env, owner.email)).rejects.toMatchObject({ status: 403 });
    expect(roundTrips).toBe(0);
    env.STAFF_ACCOUNTS = JSON.stringify([{ ...owner, role: '前台' }]);
    await expect(resolveAccount(env, owner.email)).rejects.toMatchObject({ status: 403 });
    expect(roundTrips).toBe(0);
  });

  it('默认优先初始门店，列表保持既有排序，显式选择与账户独立上下文不改变', async () => {
    await initialize();
    store('older', '2000-01-01 00:00:00');
    store('newer', '2099-01-01 00:00:00');
    store('outside', '1999-01-01 00:00:00', false);
    expect((await resolveAccount(env, owner.email)).tenant_id).toBe('initial');
    expect((await resolveAccount(env, owner.email, false, 'newer')).tenant_id).toBe('newer');
    expect((await resolveAccount(env, owner.email, false, '')).tenant_id).toBe('');
    await expect(resolveAccount(env, owner.email, false, 'outside')).rejects.toMatchObject({
      status: 403,
    });
    const resolved = await resolveAccountRequest(env, owner.email, false, 'newer', undefined, {
      includeStores: true,
    });
    expect(resolved.stores).toEqual(await storesForAccount(env, owner.email));
    expect(resolved.stores?.map((s) => s.id)).toEqual(['older', 'initial', 'newer']);
    expect(resolved.session.tenant_id).toBe('newer');
    expect(resolved.recoveredStore).toBe(false);
    db.prepare('UPDATE store_memberships SET enabled=0 WHERE email=? AND tenant_id=?').run(
      owner.email,
      'initial',
    );
    expect((await resolveAccount(env, owner.email)).tenant_id).toBe('older');
  });

  it.each([false, true])(
    '失效默认门店在同一次读取中恢复，不额外重跑（列表=%s）',
    async (includeStores) => {
      await initialize();
      const resolved = await resolveAccountRequest(
        env,
        owner.email,
        false,
        'stale-cookie',
        undefined,
        { recoverStore: true, includeStores },
      );
      expect(resolved.session.tenant_id).toBe('initial');
      expect(resolved.recoveredStore).toBe(true);
      expect(roundTrips).toBe(1);
      expect(batches).toBe(0);
    },
  );

  it('首次引导期间门店被删除，事务与复读不能凭旧读取授予门店权限', async () => {
    beforeBatch = () => {
      db.prepare('INSERT INTO stores(id,name,deleted_at) VALUES(?,?,CURRENT_TIMESTAMP)').run(
        'initial',
        '已删除',
      );
    };
    await expect(resolveAccount(env, owner.email, false, 'initial')).rejects.toMatchObject({
      status: 403,
    });
    expect(db.prepare('SELECT email FROM store_memberships').get()).toBeUndefined();
    expect(roundTrips).toBe(3);
    expect(batches).toBe(1);
  });

  it('首次引导期间出现已停用成员，INSERT OR IGNORE 不覆盖撤权记录', async () => {
    beforeBatch = () => {
      db.prepare('INSERT INTO stores(id,name) VALUES(?,?)').run('initial', '门店');
      db.prepare(
        "INSERT INTO store_memberships(email,tenant_id,name,source,enabled) VALUES(?,?,?,'managed',0)",
      ).run(owner.email, 'initial', owner.name);
    };
    expect((await resolveAccount(env, owner.email)).tenant_id).toBe('');
    expect(db.prepare('SELECT enabled FROM store_memberships').get()!.enabled).toBe(0);
    expect(roundTrips).toBe(3);
  });

  it('保留删除墓碑时不重复创建初始门店，未绑定门店的首次账户仍能建立', async () => {
    await initialize();
    db.prepare('DELETE FROM store_memberships WHERE tenant_id=?').run('initial');
    db.prepare("UPDATE stores SET deleted_at='2000-01-01 00:00:00' WHERE id=?").run('initial');
    expect((await resolveAccount(env, owner.email)).tenant_id).toBe('');
    expect(roundTrips).toBe(1);
    expect(batches).toBe(0);
    env.STAFF_ACCOUNTS = JSON.stringify([
      { email: 'independent@example.com', name: '独立', role: '店主' },
    ]);
    roundTrips = 0;
    expect((await resolveAccount(env, 'independent@example.com')).tenant_id).toBe('');
    expect(roundTrips).toBe(3);
    expect(batches).toBe(1);
  });

  it('明确门店查询使用账户和成员主键，不扫描整张成员表或其他账户门店', async () => {
    await initialize();
    for (let i = 0; i < 100; i++) store('outside-' + i, '2000-01-01 00:00:00', false);
    const query = accountSnapshotQuery(owner.email, 'initial', 'initial', 'current');
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.values) as any[];
    const detail = plan.map((p) => p.detail).join('\n');
    expect(detail).toMatch(
      /SEARCH m USING INDEX sqlite_autoindex_store_memberships_1 \(email=\? AND tenant_id=\?\)/,
    );
    expect(detail).toMatch(/SEARCH a USING INDEX sqlite_autoindex_accounts_1/);
    expect(detail).toMatch(/SEARCH i USING.*\(email=\? AND tenant_id=\?\)/);
    expect(detail).not.toMatch(/SCAN (?:m|a|i)\b/);
  });
});
