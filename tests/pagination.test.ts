import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { app } from '../server/index';
import { buildListQuery } from '../server/read-model';
import { encodeCursor } from '../server/pagination';
import { today } from '../shared/calendar';
let db: DatabaseSync, env: any, cookie: string;
function statement(sql: string, args: any[] = []): any {
  return {
    bind: (...values: any[]) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: db.prepare(sql).run(...args) }),
  };
}
async function req(path: string) {
  return app.request('http://localhost/api' + path, { headers: { Cookie: cookie } }, env);
}
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations-production')
    .filter((file) => file.endsWith('.sql'))
    .sort())
    db.exec(readFileSync('migrations-production/' + file, 'utf8'));
  env = {
    DEMO_MODE: 'true',
    DB: {
      prepare: statement,
      batch: async (stmts: any[]) => {
        db.exec('BEGIN');
        try {
          const results = [];
          for (const s of stmts) results.push(await s.all());
          db.exec('COMMIT');
          return results;
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
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
});
function customer(
  id: string,
  tenant = 'demo-store',
  name = id,
  status = '待评估',
  birth = '',
  source = '自然到店',
) {
  db.prepare(
    "INSERT INTO customers(id,tenant_id,name,gender,birth_date,phone,source,status,created_at) VALUES(?,?,?,'未填写',?,'虚构号码',?,?, '2026-09-30 12:00:00')",
  ).run(id, tenant, name, birth, source, status);
}
function fitting(
  id: string,
  customerId: string,
  tenant = 'demo-store',
  warranty = '',
  side = '双耳',
) {
  db.prepare(
    "INSERT INTO fittings(id,tenant_id,customer_id,date,data,created_at) VALUES(?,?,?,'2026-09-30',?,'2026-09-30 12:00:00')",
  ).run(
    id,
    tenant,
    customerId,
    JSON.stringify({
      date: '2026-09-30',
      model: '型号-' + id,
      side,
      warranty,
      serialLeft: 'SN-' + id,
      notes: '',
    }),
  );
}
function repair(
  id: string,
  customerId: string,
  fittingId: string,
  status = '待送修',
  tenant = 'demo-store',
) {
  db.prepare(
    "INSERT INTO repairs(id,tenant_id,customer_id,fitting_id,occurred_date,status,problem,created_at) VALUES(?,?,?,?,'2026-09-30',?,'故障-'||?,'2026-09-30 12:00:00')",
  ).run(id, tenant, customerId, fittingId, status, id);
}
function followup(
  id: string,
  customerId: string,
  completed = 0,
  due = '2026-09-30',
  tenant = 'demo-store',
) {
  db.prepare(
    "INSERT INTO followups(id,tenant_id,customer_id,due,type,note,completed) VALUES(?,?,?,?,'适应回访','',?)",
  ).run(id, tenant, customerId, due, completed);
}
async function read(path: string) {
  const response = await req(path);
  expect(response.status).toBe(200);
  return (await response.json()) as any;
}

describe('游标列表与聚合', () => {
  it('默认有界，页大小有上限，相同时间戳不重不漏，无深 OFFSET', async () => {
    for (let i = 0; i < 135; i++) customer('c' + String(i).padStart(4, '0'));
    expect(await read('/customers')).toHaveLength(50);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await read(
        '/customers?paged=1&limit=17' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      );
      expect(page.items.length).toBeLessThanOrEqual(17);
      seen.push(...page.items.map((row: any) => row.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(135);
    expect(new Set(seen).size).toBe(135);
    for (const limit of ['0', '101', '2.5', 'abc'])
      expect((await req('/customers?limit=' + limit)).status).toBe(400);
    const plan = buildListQuery('customers', 'demo-store', { limit: '50' });
    expect(plan.sql).not.toMatch(/OFFSET/i);
    expect(plan.values.at(-1)).toBe(51);
  });
  it('游标无需边界行存在，新记录不会挤入后续页', async () => {
    for (let i = 0; i < 8; i++) customer('c' + i);
    const first = await read('/customers?paged=1&limit=3');
    db.prepare('DELETE FROM customers WHERE id=?').run(first.items.at(-1).id);
    customer('z-new');
    const next = await read('/customers?paged=1&limit=3&cursor=' + first.nextCursor);
    expect(next.items.map((row: any) => row.id)).toEqual(['c4', 'c3', 'c2']);
  });
  it('筛选/搜索覆盖整店，通配符作为文本，单客入口不依赖第一页', async () => {
    for (let i = 0; i < 80; i++) customer('c' + String(i).padStart(4, '0'));
    customer('a-remote', 'demo-store', '远端客户', '长期随访');
    customer('a-literal', 'demo-store', '百分%_号');
    expect(
      (await read('/customers?paged=1&q=' + encodeURIComponent('远端'))).items.map(
        (row: any) => row.id,
      ),
    ).toEqual(['a-remote']);
    expect(
      (await read('/customers?paged=1&filter=' + encodeURIComponent('长期随访'))).items,
    ).toHaveLength(1);
    expect((await read('/customers?paged=1&q=%25_')).items.map((row: any) => row.id)).toEqual([
      'a-literal',
    ]);
    expect((await read('/search?q=' + encodeURIComponent('远端')))[0].id).toBe('a-remote');
    expect((await read('/customers/a-remote')).name).toBe('远端客户');
    expect(
      await read('/customers/duplicates?name=' + encodeURIComponent('远端客户') + '&birthDate='),
    ).toHaveLength(1);
  });
  it('游标绑定门店、接口、筛选和关键词，不授予访问资格', async () => {
    for (let i = 0; i < 3; i++) customer('c' + i);
    const first = await read('/customers?paged=1&limit=1'),
      cursor = first.nextCursor;
    for (const path of [
      '/customers?filter=' + encodeURIComponent('长期随访'),
      '/customers?q=other',
      '/devices',
    ])
      expect((await req(path + (path.includes('?') ? '&' : '?') + 'cursor=' + cursor)).status).toBe(
        400,
      );
    for (const bad of ['garbage', 'x'.repeat(2049), encodeURIComponent('{"keys":[]}')])
      expect((await req('/customers?cursor=' + bad)).status).toBe(400);
    const created = await app.request(
      'http://localhost/api/accounts/stores',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '另一店' }),
      },
      env,
    );
    const { id } = (await created.json()) as any;
    const scoped = await app.request(
      'http://localhost/api/customers?paged=1&cursor=' + cursor,
      { headers: { Cookie: cookie, 'X-Hearing-Store': id } },
      env,
    );
    expect(scoped.status).toBe(400);
    expect(
      (
        await app.request(
          'http://localhost/api/summary',
          { headers: { Cookie: cookie, 'X-Hearing-Store': 'not-member' } },
          env,
        )
      ).status,
    ).toBe(403);
    expect((await req('/customers/not-existing')).status).toBe(404);
  });
  it.each(['devices', 'repairs', 'followups', 'warranties'] as const)(
    '%s 分页不漏记录，隐藏外店与删除父记录',
    async (kind) => {
      customer('active');
      customer('deleted');
      customer('outsider', 'other');
      for (let i = 0; i < 27; i++) {
        const id = String(i).padStart(3, '0');
        fitting('f' + id, 'active', 'demo-store', '2026-10-20');
        repair('r' + id, 'active', 'f' + id, i % 2 ? '维修中' : '待送修');
        followup('u' + id, 'active', i % 2);
      }
      fitting('hidden', 'deleted', 'demo-store', '2026-10-20');
      repair('hidden-repair', 'deleted', 'hidden');
      followup('hidden-task', 'deleted');
      db.prepare('UPDATE customers SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run('deleted');
      fitting('foreign', 'outsider', 'other', '2026-10-20');
      repair('foreign-repair', 'outsider', 'foreign', '待送修', 'other');
      followup('foreign-task', 'outsider', 0, '2026-10-20', 'other');
      let cursor: string | null = null;
      const seen: string[] = [];
      do {
        const page = await read(
          '/' + kind + '?paged=1&limit=4' + (cursor ? '&cursor=' + cursor : ''),
        );
        seen.push(...page.items.map((row: any) => row.id));
        expect(page.items.every((row: any) => row.customer_id === 'active')).toBe(true);
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(27);
      expect(new Set(seen).size).toBe(27);
    },
  );
  it('设备序列号、维修状态和跨页故障搜索由 SQL 筛选', async () => {
    customer('owner');
    for (let i = 0; i < 65; i++) {
      fitting('f' + i, 'owner');
      repair('r' + i, 'owner', 'f' + i, '已完成');
    }
    fitting('unique', 'owner', 'demo-store', '', '左耳');
    repair('unique-repair', 'owner', 'unique', '维修中');
    expect((await read('/devices?paged=1&q=SN-unique')).items.map((r: any) => r.id)).toEqual([
      'unique',
    ]);
    expect(
      (await read('/devices?paged=1&filter=' + encodeURIComponent('左耳'))).items,
    ).toHaveLength(1);
    expect(
      (await read('/repairs?paged=1&filter=' + encodeURIComponent('维修中'))).items.map(
        (r: any) => r.id,
      ),
    ).toEqual(['unique-repair']);
    expect(
      (await read('/repairs?paged=1&q=' + encodeURIComponent('故障-unique-repair'))).items,
    ).toHaveLength(1);
  });
  it('保修游标跨同日、不同日和未填日期区间仍保持顺序', async () => {
    customer('owner');
    for (let i = 0; i < 16; i++)
      fitting(
        'f' + String(i).padStart(2, '0'),
        'owner',
        'demo-store',
        i < 5 ? '2026-09-01' : i < 11 ? '2026-10-01' : '',
      );
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const page = await read('/warranties?paged=1&limit=3' + (cursor ? '&cursor=' + cursor : ''));
      ids.push(...page.items.map((r: any) => r.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 16 }, (_, i) => 'f' + String(i).padStart(2, '0')));
  });
  it('固定完成状态和今日日期的随访可以完整翻页', async () => {
    customer('owner');
    for (let i = 0; i < 5; i++) {
      followup('today' + i, 'owner', 0, today());
      followup('past' + i, 'owner', 0, '2026-01-01');
      followup('done' + i, 'owner', 1, today());
    }
    for (const [filter, count] of [
      ['待完成', 10],
      ['今日', 5],
      ['已逾期', 5],
      ['已完成', 5],
    ] as const) {
      let cursor: string | null = null;
      const ids: string[] = [];
      do {
        const page = await read(
          '/followups?paged=1&limit=2&filter=' +
            encodeURIComponent(filter) +
            (cursor ? '&cursor=' + cursor : ''),
        );
        ids.push(...page.items.map((row: any) => row.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(ids).toHaveLength(count);
      expect(new Set(ids).size).toBe(count);
    }
  });
  it('日历游标跨北京时间午夜失效，普通客户游标仍可使用', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T16:10:00Z'));
    customer('a');
    customer('b');
    followup('a', 'a');
    followup('b', 'b');
    const customerPage = await read('/customers?paged=1&limit=1'),
      taskPage = await read('/followups?paged=1&limit=1');
    vi.setSystemTime(new Date('2026-10-01T16:10:00Z'));
    expect((await req('/followups?paged=1&cursor=' + taskPage.nextCursor)).status).toBe(400);
    expect((await read('/customers?paged=1&cursor=' + customerPage.nextCursor)).items).toHaveLength(
      1,
    );
  });
  it('北京时间聚合计算全部客户、年龄、阶段、随访和保修，排除删除和外店', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T16:15:00Z'));
    customer('one', 'demo-store', '甲', '已验配', '1960-10-01', '__proto__');
    customer('two', 'demo-store', '乙', '长期随访', '1986-10-01', '');
    customer('three', 'demo-store', '丙', '待评估', '1986-10-02');
    customer('four', 'demo-store', '丁', '待评估', '1946-10-01');
    customer('five');
    customer('foreign', 'other');
    customer('deleted');
    db.prepare('UPDATE customers SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run('deleted');
    fitting('expired', 'one', 'demo-store', '2026-09-30');
    fitting('today', 'two', 'demo-store', today());
    fitting('edge', 'three', 'demo-store', '2026-12-30');
    fitting('future', 'four', 'demo-store', '2026-12-31');
    fitting('missing', 'five');
    fitting('hidden', 'deleted', 'demo-store', today());
    fitting('foreign', 'foreign', 'other', today());
    followup('today', 'one', 0, today());
    followup('overdue', 'two', 0, '2026-09-30');
    followup('done', 'three', 1, today());
    followup('hidden', 'deleted');
    followup('foreign', 'foreign', 0, today(), 'other');
    repair('repair', 'one', 'expired');
    repair('hidden', 'deleted', 'hidden');
    const base = await read('/summary');
    expect(base).toMatchObject({
      date: '2026-10-01',
      customers: 5,
      fitted: 2,
      pending: 2,
      completed: 1,
      today: 1,
      overdue: 1,
      devices: 5,
      repairs: 1,
      warrantyAlerts: 3,
    });
    expect(base.sources).toBeUndefined();
    const detail = await read('/summary?detail=1');
    expect(detail.sources.__proto__).toBe(1);
    expect(detail.ages).toEqual({
      '40 岁以下': 1,
      '40–59 岁': 1,
      '60–79 岁': 1,
      '80 岁及以上': 1,
      未填写: 1,
    });
    expect(detail.types['适应回访']).toBe(3);
    expect(
      (await read('/warranties?paged=1&filter=' + encodeURIComponent('需关注'))).items,
    ).toHaveLength(3);
    expect(
      (await read('/followups?paged=1&filter=' + encodeURIComponent('今日'))).items.map(
        (row: any) => row.id,
      ),
    ).toEqual(['today']);
  });
  it('回收站按删除游标分页，过期不出现；空店聚合为零', async () => {
    for (let i = 0; i < 12; i++) {
      customer('removed' + i);
      db.prepare('UPDATE customers SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run('removed' + i);
    }
    customer('expired');
    db.exec("UPDATE customers SET deleted_at=datetime('now','-31 days') WHERE id='expired'");
    const first = await read('/customers/removed?paged=1&limit=5');
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).toBeTruthy();
    expect((await read('/summary')).customers).toBe(0);
  });
  it('第一页和深游标使用索引范围，不产生临时排序或 OFFSET', () => {
    const cursorCases = [
      'customers',
      'removed',
      'devices',
      'repairs',
      'followups',
      'warranties',
    ] as const;
    for (const kind of cursorCases) {
      const first = buildListQuery(kind, 'demo-store', { limit: '20' });
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + first.sql).all(...first.values) as any[];
      expect(
        plan.some((row) => row.detail.includes('SEARCH') && row.detail.includes('_page')),
      ).toBe(true);
      expect(plan.some((row) => row.detail.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false);
      expect(first.sql).not.toMatch(/OFFSET/);
      const boundary =
        kind === 'followups'
          ? [0, '2026-01-01', 'deep-id']
          : kind === 'repairs'
            ? [1, '2026-01-01', '2026-01-01 00:00:00', 'deep-id']
            : kind === 'devices'
              ? ['2026-01-01', '2026-01-01 00:00:00', 'deep-id']
              : ['2026-01-01 00:00:00', 'deep-id'];
      const deep = buildListQuery(kind, 'demo-store', {
        limit: '20',
        cursor: encodeCursor(first.scope, boundary),
      });
      for (const range of [deep, deep.continuation].filter(Boolean) as {
        sql: string;
        values: any[];
      }[]) {
        const deepPlan = db
          .prepare('EXPLAIN QUERY PLAN ' + range.sql)
          .all(...range.values) as any[];
        expect(
          deepPlan.some((row) => row.detail.includes('_page') && /[<>]/.test(row.detail)),
          JSON.stringify([kind, deepPlan]),
        ).toBe(true);
        expect(
          deepPlan.some((row) => row.detail.includes('USE TEMP B-TREE FOR ORDER BY')),
          JSON.stringify([kind, deepPlan]),
        ).toBe(false);
        expect(range.sql).not.toMatch(/OFFSET/);
      }
    }
  });
  it('带阶段、耳侧、状态筛选的深页仍按游标定位', () => {
    const cases = [
      ['customers', '已验配', ['2026-01-01 00:00:00', 'deep-id']],
      ['devices', '左耳', ['2026-01-01', '2026-01-01 00:00:00', 'deep-id']],
      ['repairs', '维修中', [1, '2026-01-01', '2026-01-01 00:00:00', 'deep-id']],
      ['followups', '待完成', [0, '2026-01-01', 'deep-id']],
      ['followups', '今日', [0, today(), 'deep-id']],
      ['warranties', '未填写', ['9999', 'deep-id']],
    ] as const;
    for (const [kind, filter, keys] of cases) {
      const first = buildListQuery(kind, 'demo-store', { filter });
      const deep = buildListQuery(kind, 'demo-store', {
        filter,
        cursor: encodeCursor(first.scope, [...keys]),
      });
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + deep.sql).all(...deep.values) as any[];
      expect(
        plan.some((row) => row.detail.includes('_page') && /[<>]/.test(row.detail)),
        JSON.stringify([kind, filter, plan]),
      ).toBe(true);
      expect(
        plan.some((row) => row.detail.includes('USE TEMP B-TREE FOR ORDER BY')),
        JSON.stringify([kind, filter, plan]),
      ).toBe(false);
    }
  });
});
