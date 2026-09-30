import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { app } from '../server/index';
import { purgeExpiredRecords } from '../server/retention';
import { frequencies } from '../server/domain';
let db: DatabaseSync, env: any, cookie: string;
function statement(sql: string, args: any[] = []): any {
  return {
    bind: (...values: any[]) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ success: true, meta: db.prepare(sql).run(...args) }),
  };
}
async function req(path: string, method = 'GET', data?: any, headers: Record<string, string> = {}) {
  return app.request(
    'http://localhost/api' + path,
    {
      method,
      headers: { Cookie: cookie || '', 'Content-Type': 'application/json', ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
    env,
  );
}
async function switchToNewStore() {
  const created = await req('/accounts/stores', 'POST', { name: '隔离测试门店' });
  expect(created.status).toBe(201);
  const { id } = await created.json() as any;
  const switched = await req('/accounts/stores/' + id + '/switch', 'POST');
  expect(switched.status).toBe(200);
  cookie = cookie.split(';')[0] + '; ' + switched.headers.get('Set-Cookie')!.split(';')[0];
}
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_schema.sql', 'utf8'));
  db.exec(readFileSync('migrations/0002_demo_seed.sql', 'utf8'));
  db.exec(readFileSync('migrations/0003_device_catalog.sql', 'utf8'));
  db.exec(readFileSync('migrations/0004_intake_and_corrections.sql', 'utf8'));
  db.exec(readFileSync('migrations/0005_record_lifecycle.sql', 'utf8'));
  db.exec(readFileSync('migrations/0006_attachment_retention.sql', 'utf8'));
  db.exec(readFileSync('migrations/0008_repairs.sql', 'utf8'));
  db.exec(readFileSync('migrations/0009_accounts.sql', 'utf8'));
  db.exec(readFileSync('migrations/0010_stores.sql', 'utf8'));
  db.exec(readFileSync('migrations/0011_account_profiles_store_lifecycle.sql', 'utf8'));
  db.exec(readFileSync('migrations/0012_independent_accounts.sql', 'utf8'));
  const files = new Map<string, ArrayBuffer>();
  env = {
    DEMO_MODE: 'true',
    DB: {
      prepare: statement,
      batch: async (stmts: any[]) => {
        db.exec('BEGIN');
        try {
          const out = [];
          for (const s of stmts) out.push(await s.all());
          db.exec('COMMIT');
          return out;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
    FILES: {
      put: async (key: string, bytes: ArrayBuffer) => files.set(key, bytes),
      get: async (key: string) => (files.has(key) ? { body: files.get(key) } : null),
      delete: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) files.delete(key);
      },
    },
  };
  cookie = '';
  const login = await req('/login', 'POST', { role: '店主' });
  cookie = login.headers.get('Set-Cookie')!.split(';')[0];
});
describe('演示 API', () => {
  it('最后一位成员退出后门店进入保留期，账户独立登录并可恢复加入', async () => {
    const own = await (await req('/me')).json() as any;
    expect((await req('/accounts/stores/demo-store/leave', 'POST')).status).toBe(200);
    expect((await (await req('/me')).json() as any).tenant_id).toBe('');
    expect((await req('/customers')).status).toBe(403);
    expect((await req('/accounts/presence', 'POST')).status).toBe(200);
    expect((db.prepare('SELECT enabled FROM store_memberships WHERE email=?').get(own.email) as any).enabled).toBe(0);
    expect((db.prepare('SELECT abandoned_at FROM stores WHERE id=?').get('demo-store') as any).abandoned_at).toBeTruthy();
    expect((await (await req('/accounts/stores/left')).json() as any[])[0].id).toBe('demo-store');
    expect((await req('/accounts', 'PUT', { email: own.email, name: '独立用户', enabled: true })).status).toBe(200);
    expect((await req('/accounts/stores/demo-store/rejoin', 'POST')).status).toBe(200);
    expect((await req('/customers/demo-1/detail')).status).toBe(200);
    expect((await (await req('/me')).json() as any).name).toBe('独立用户');
    expect((db.prepare('SELECT abandoned_at FROM stores WHERE id=?').get('demo-store') as any).abandoned_at).toBeNull();
  });
  it('无人管理的门店 30 天后清理，旧配置不重建门店，个人资料保留', async () => {
    await req('/accounts', 'PUT', { email: 'owner@demo.invalid', name: '保留姓名', enabled: true });
    await req('/accounts/stores/demo-store/leave', 'POST');
    db.prepare("UPDATE stores SET abandoned_at='2000-01-01 00:00:00' WHERE id='demo-store'").run();
    db.prepare("UPDATE store_memberships SET left_at='2000-01-01 00:00:00' WHERE tenant_id='demo-store'").run();
    expect((await req('/accounts/stores/demo-store/rejoin', 'POST')).status).toBe(403);
    await purgeExpiredRecords(env);
    expect((db.prepare("SELECT COUNT(*) n FROM customers WHERE tenant_id='demo-store'").get() as any).n).toBe(0);
    expect((await (await req('/me')).json() as any).tenant_id).toBe('');
    expect((await (await req('/me')).json() as any).name).toBe('保留姓名');
    expect(await (await req('/accounts/stores')).json()).toEqual([]);
    expect((await req('/accounts/stores/demo-store/restore', 'POST')).status).toBe(404);
    expect((await req('/accounts/stores', 'POST', { name: '重新开店' })).status).toBe(201);
  });
  it('可以删除唯一门店，账户仍能登录并在保留期内恢复', async () => {
    const me = await (await req('/me')).json() as any;
    const removed = await req('/accounts/stores/demo-store', 'DELETE', { name: me.storeName });
    expect(removed.status).toBe(200);
    expect((await removed.json() as any).nextStoreId).toBe('');
    expect((await (await req('/me')).json() as any).tenant_id).toBe('');
    expect((await req('/accounts')).status).toBe(200);
    expect((await req('/export')).status).toBe(403);
    expect((await req('/accounts/stores/demo-store/restore', 'POST')).status).toBe(200);
    expect((await req('/customers/demo-1/detail')).status).toBe(200);
  });
  it('头像和姓名归账户所有，切换门店不丢失头像，拒绝外链和 SVG', async () => {
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    const account = { email: 'owner@demo.invalid', name: '店主', enabled: true, avatar };
    expect((await req('/accounts', 'PUT', account)).status).toBe(200);
    expect((await (await req('/me')).json() as any).avatar).toBe(avatar);
    expect((await (await req('/accounts')).json() as any[])[0].avatar).toBe(avatar);
    expect((await req('/accounts', 'PUT', { ...account, avatar: undefined, name: '新名称' })).status).toBe(200);
    expect((await (await req('/me')).json() as any).avatar).toBe(avatar);
    for (const invalid of ['https://example.com/avatar.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,invalid', avatar + 'A'.repeat(50000)]) {
      expect((await req('/accounts', 'PUT', { ...account, avatar: invalid })).status).toBe(400);
    }
    await switchToNewStore();
    expect((await (await req('/me')).json() as any).avatar).toBe(avatar);
    expect((await (await req('/me')).json() as any).name).toBe('新名称');
    const switched = await req('/accounts/stores/demo-store/switch', 'POST');
    cookie = cookie.split(';')[0] + '; ' + switched.headers.get('Set-Cookie')!.split(';')[0];
    expect((await (await req('/me')).json() as any).avatar).toBe(avatar);
    expect((await req('/accounts', 'PUT', { ...account, avatar: '' })).status).toBe(200);
    expect((await (await req('/me')).json() as any).avatar).toBe('');
  });
  it('门店删除需确认名称，30 天内可恢复并保留原有资料', async () => {
    await switchToNewStore();
    const me = await (await req('/me')).json() as any;
    const created = await (await req('/customers', 'POST', { name: '分店客户', gender: '未填写', birthDate: '', phone: '', source: '', status: '待评估' })).json() as any;
    expect((await req('/accounts/stores/demo-store', 'DELETE', { name: '演示门店' })).status).toBe(403);
    expect((await req('/accounts/stores/' + me.tenant_id, 'DELETE', { name: '错误名称' })).status).toBe(400);
    const deleted = await req('/accounts/stores/' + me.tenant_id, 'DELETE', { name: me.storeName });
    expect(deleted.status).toBe(200);
    cookie = cookie.split(';')[0] + '; ' + deleted.headers.get('Set-Cookie')!.split(';')[0];
    expect((await (await req('/me')).json() as any).tenant_id).toBe('demo-store');
    expect((await req('/customers/' + created.id + '/detail')).status).toBe(404);
    expect((await req('/accounts/stores/' + me.tenant_id + '/switch', 'POST')).status).toBe(403);
    expect((await (await req('/accounts/stores/removed')).json() as any[])[0].id).toBe(me.tenant_id);
    expect((await req('/accounts/stores/' + me.tenant_id + '/restore', 'POST')).status).toBe(200);
    const switched = await req('/accounts/stores/' + me.tenant_id + '/switch', 'POST');
    cookie = cookie.split(';')[0] + '; ' + switched.headers.get('Set-Cookie')!.split(';')[0];
    expect((await req('/customers/' + created.id + '/detail')).status).toBe(200);
  });
  it('过期门店清理客户、头像、业务和 R2 附件，保留其他门店', async () => {
    await switchToNewStore();
    const me = await (await req('/me')).json() as any;
    const customer = await (await req('/customers', 'POST', { name: '待清理客户', gender: '未填写', birthDate: '', phone: '', source: '', status: '待评估' })).json() as any;
    const form = new FormData();
    form.append('file', new File(['%PDF-1.4\nfictional'], 'store.pdf', { type: 'application/pdf' }));
    const uploaded = await app.request('http://localhost/api/customers/' + customer.id + '/attachments',
      { method: 'POST', headers: { Cookie: cookie }, body: form }, env);
    const fileId = (await uploaded.json() as any).id;
    const key = (db.prepare('SELECT object_key FROM attachments WHERE id=?').get(fileId) as any).object_key;
    const deleted = await req('/accounts/stores/' + me.tenant_id, 'DELETE', { name: me.storeName });
    cookie = cookie.split(';')[0] + '; ' + deleted.headers.get('Set-Cookie')!.split(';')[0];
    db.prepare("UPDATE stores SET deleted_at='2026-01-01 00:00:00' WHERE id=?").run(me.tenant_id);
    expect((await req('/accounts/stores/' + me.tenant_id + '/restore', 'POST')).status).toBe(404);
    expect(await (await req('/accounts/stores/removed')).json()).toEqual([]);
    await purgeExpiredRecords(env, new Date('2026-09-30T00:00:00Z'));
    expect(await env.FILES.get(key)).toBeNull();
    for (const table of ['customers', 'attachments', 'exams', 'fittings', 'repairs', 'followups', 'audit', 'store_memberships'])
      expect((db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE tenant_id=?`).get(me.tenant_id) as any).n).toBe(0);
    expect((await req('/customers/demo-1/detail')).status).toBe(200);
    expect((await req('/accounts/stores/' + me.tenant_id + '/restore', 'POST')).status).toBe(404);
  });
  it('直接作图保存 UCL 和六频听阈，保留旧频率，不要求文字结论', async () => {
    const curve = () =>
      frequencies.map((frequency) => ({
        frequency,
        value: frequency === 125 ? 30 : frequency === 1000 ? 45 : null,
        masked: false,
        noResponse: false,
      }));
    const data = {
      date: '2026-09-27',
      right: curve(),
      left: curve(),
      boneRight: curve(),
      boneLeft: curve(),
      uclRight: curve().map((p) => ({ ...p, value: p.frequency === 1000 ? 95 : null })),
      uclLeft: curve().map((p) => ({ ...p, value: p.frequency === 2000 ? 100 : null })),
      speech: '',
      other: '',
      conclusion: '',
    };
    const response = await req('/customers/demo-1/exams', 'POST', data);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as any;
    const detail = (await (await req('/customers/demo-1/detail')).json()) as any;
    const saved = detail.exams.find((row: any) => row.id === id);
    expect(saved.uclRight.find((p: any) => p.frequency === 1000).value).toBe(95);
    expect(saved.right.find((p: any) => p.frequency === 125).value).toBe(30);
    const edited = {
      ...saved,
      uclLeft: saved.uclLeft.map((p: any) => (p.frequency === 2000 ? { ...p, value: null } : p)),
    };
    expect((await req('/customers/demo-1/exams/' + id, 'PUT', edited)).status).toBe(200);
    const updated = (await (await req('/customers/demo-1/detail')).json()) as any;
    expect(
      updated.exams.find((r: any) => r.id === id).uclLeft.find((p: any) => p.frequency === 2000)
        .value,
    ).toBeNull();
  });
  it('维修记录可关联验配设备、修改、检索、删除与恢复', async () => {
    const fitting = db
      .prepare("SELECT id FROM fittings WHERE customer_id='demo-1' LIMIT 1")
      .get() as any;
    const data = {
      fittingId: fitting.id,
      occurredDate: '2026-09-20',
      receivedDate: '2026-09-21',
      completedDate: '',
      status: '维修中',
      problem: '受话器无声',
      findings: '受话器损坏',
      workDone: '等待配件',
      parts: '受话器 1 件',
      price: 180,
      warrantyCovered: false,
      notes: '客户要求短信通知',
    };
    const created = await req('/customers/demo-1/repairs', 'POST', data);
    expect(created.status).toBe(201);
    const repairId = ((await created.json()) as any).id;
    expect((await req('/login', 'POST', { role: '前台' })).status).toBe(400);
    expect(((await (await req('/customers/demo-1/detail')).json()) as any).repairs[0].parts).toBe(
      '受话器 1 件',
    );
    expect(((await (await req('/search?q=受话器无声')).json()) as any[])[0].id).toBe('demo-1');
    expect(
      (
        await req(`/customers/demo-1/repairs/${repairId}`, 'PUT', {
          ...data,
          completedDate: '2026-09-22',
          status: '已完成',
          workDone: '已更换受话器',
          price: 200,
        })
      ).status,
    ).toBe(200);
    expect((await req(`/customers/demo-1/repairs/${repairId}`, 'DELETE')).status).toBe(200);
    expect(((await (await req('/customers/demo-1/detail')).json()) as any).repairs).toHaveLength(0);
    expect(((await (await req('/customers/demo-1/removed')).json()) as any).repairs).toHaveLength(
      1,
    );
    expect((await req(`/customers/demo-1/repairs/${repairId}/restore`, 'POST')).status).toBe(200);
    expect(((await (await req('/customers/demo-1/detail')).json()) as any).repairs[0].price).toBe(
      200,
    );
    await req(`/customers/demo-1/repairs/${repairId}`, 'DELETE');
    db.prepare("UPDATE repairs SET deleted_at='2026-01-01 00:00:00' WHERE id=?").run(repairId);
    await purgeExpiredRecords(env);
    expect(db.prepare('SELECT id FROM repairs WHERE id=?').get(repairId)).toBeUndefined();
  });
  it('全局设备与维修目录返回关联资料，隔离门店并隐藏已删除的记录及其子记录', async () => {
    const fitting = db
      .prepare("SELECT id FROM fittings WHERE customer_id='demo-1' LIMIT 1")
      .get() as any;
    const created = await req('/customers/demo-1/repairs', 'POST', {
      fittingId: fitting.id,
      occurredDate: '2026-09-27',
      receivedDate: '',
      completedDate: '',
      status: '维修中',
      problem: '目录关联测试',
      findings: '',
      workDone: '',
      parts: '',
      price: 50,
      warrantyCovered: false,
      notes: '',
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as any;
    const devices = (await (await req('/devices')).json()) as any[];
    expect(devices.find((row) => row.id === fitting.id)).toMatchObject({
      customer_id: 'demo-1',
      name: '陈淑华',
      repair_count: 1,
    });
    const repairs = (await (await req('/repairs')).json()) as any[];
    expect(repairs.find((row) => row.id === id)).toMatchObject({
      customer_id: 'demo-1',
      fitting_id: fitting.id,
      device: { id: fitting.id },
    });
    const ownerCookie = cookie;
    await switchToNewStore();
    expect(await (await req('/devices')).json()).toEqual([]);
    expect(await (await req('/repairs')).json()).toEqual([]);
    cookie = ownerCookie;
    await req(`/customers/demo-1/repairs/${id}`, 'DELETE');
    expect(await (await req('/repairs')).json()).toEqual([]);
    expect(
      ((await (await req('/devices')).json()) as any[]).find((row) => row.id === fitting.id)
        .repair_count,
    ).toBe(0);
    await req(`/customers/demo-1/repairs/${id}/restore`, 'POST');
    await req(`/customers/demo-1/fittings/${fitting.id}`, 'DELETE');
    expect(await (await req('/repairs')).json()).toEqual([]);
    expect(
      ((await (await req('/devices')).json()) as any[]).some((row) => row.id === fitting.id),
    ).toBe(false);
    await req(`/customers/demo-1/fittings/${fitting.id}/restore`, 'POST');
    await req('/customers/demo-1', 'DELETE');
    expect(await (await req('/repairs')).json()).toEqual([]);
    expect(
      ((await (await req('/devices')).json()) as any[]).some((row) => row.customer_id === 'demo-1'),
    ).toBe(false);
  });
  it('报告删除后无法下载，30 天内可恢复', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File(['%PDF-1.4\nfictional'], 'delete-test.pdf', { type: 'application/pdf' }),
    );
    const uploaded = await app.request(
      'http://localhost/api/customers/demo-1/attachments',
      { method: 'POST', headers: { Cookie: cookie }, body: form },
      env,
    );
    const fileId = ((await uploaded.json()) as any).id;
    expect((await req('/login', 'POST', { role: '前台' })).status).toBe(400);
    expect((await req(`/customers/demo-1/attachments/${fileId}`, 'DELETE')).status).toBe(200);
    expect((await req(`/files/${fileId}`)).status).toBe(404);
    const detail = (await (await req('/customers/demo-1/detail')).json()) as any;
    expect(detail.attachments.some((row: any) => row.id === fileId)).toBe(false);
    const removed = (await (await req('/customers/demo-1/removed')).json()) as any;
    expect(removed.attachments.some((row: any) => row.id === fileId)).toBe(true);
    expect((await req(`/customers/demo-1/attachments/${fileId}/restore`, 'POST')).status).toBe(200);
    expect((await req(`/files/${fileId}`)).status).toBe(200);
  });
  it('过期报告不可恢复，清理同时删除数据库行与 R2 文件', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File(['%PDF-1.4\nfictional'], 'expired.pdf', { type: 'application/pdf' }),
    );
    const uploaded = await app.request(
      'http://localhost/api/customers/demo-1/attachments',
      { method: 'POST', headers: { Cookie: cookie }, body: form },
      env,
    );
    const fileId = ((await uploaded.json()) as any).id;
    const key = (db.prepare('SELECT object_key FROM attachments WHERE id=?').get(fileId) as any)
      .object_key;
    await req(`/customers/demo-1/attachments/${fileId}`, 'DELETE');
    db.prepare("UPDATE attachments SET deleted_at='2026-01-01 00:00:00' WHERE id=?").run(fileId);
    expect((await req(`/customers/demo-1/attachments/${fileId}/restore`, 'POST')).status).toBe(404);
    expect(
      ((await (await req('/customers/demo-1/removed')).json()) as any).attachments,
    ).toHaveLength(0);
    await purgeExpiredRecords(env, new Date('2026-09-26T00:00:00Z'));
    expect(db.prepare('SELECT id FROM attachments WHERE id=?').get(fileId)).toBeUndefined();
    expect(await env.FILES.get(key)).toBeNull();
    expect(db.prepare('SELECT id FROM customers WHERE id=?').get('demo-1')).toBeDefined();
  });
  it('到期客户及关联资料彻底清除，未到期删除仍保留', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File(['%PDF-1.4\nfictional'], 'customer-expired.pdf', { type: 'application/pdf' }),
    );
    const uploaded = await app.request(
      'http://localhost/api/customers/demo-1/attachments',
      { method: 'POST', headers: { Cookie: cookie }, body: form },
      env,
    );
    const fileId = ((await uploaded.json()) as any).id;
    const key = (db.prepare('SELECT object_key FROM attachments WHERE id=?').get(fileId) as any)
      .object_key;
    await req('/customers/demo-1', 'DELETE');
    await req('/customers/demo-2', 'DELETE');
    db.prepare("UPDATE customers SET deleted_at='2026-01-01 00:00:00' WHERE id='demo-1'").run();
    expect((await req('/customers/demo-1/restore', 'POST')).status).toBe(404);
    await purgeExpiredRecords(env, new Date('2026-09-26T00:00:00Z'));
    expect(db.prepare("SELECT id FROM customers WHERE id='demo-1'").get()).toBeUndefined();
    for (const table of ['exams', 'fittings', 'followups', 'attachments', 'audit'])
      expect(
        (db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE customer_id='demo-1'`).get() as any)
          .count,
      ).toBe(0);
    expect(await env.FILES.get(key)).toBeNull();
    expect(db.prepare("SELECT id FROM customers WHERE id='demo-2'").get()).toBeDefined();
    expect((await req('/customers/demo-2/restore', 'POST')).status).toBe(200);
  });
  it('单独删除的检查、验配和随访到期后不可恢复并被清理', async () => {
    const detail = (await (await req('/customers/demo-1/detail')).json()) as any;
    const records = [
      ['exams', detail.exams[0].id],
      ['fittings', detail.fittings[0].id],
      ['followups', detail.followups[0].id],
    ] as const;
    for (const [table, recordId] of records) {
      expect((await req(`/customers/demo-1/${table}/${recordId}`, 'DELETE')).status).toBe(200);
      db.prepare(`UPDATE ${table} SET deleted_at='2026-01-01 00:00:00' WHERE id=?`).run(recordId);
      expect((await req(`/customers/demo-1/${table}/${recordId}/restore`, 'POST')).status).toBe(
        404,
      );
    }
    await purgeExpiredRecords(env, new Date('2026-09-26T00:00:00Z'));
    for (const [table, recordId] of records)
      expect(db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(recordId)).toBeUndefined();
    expect(db.prepare("SELECT id FROM customers WHERE id='demo-1'").get()).toBeDefined();
  });
  it('客户可删除与恢复，关联资料退出普通查询且文件暂不可下载', async () => {
    const form = new FormData();
    form.append('file', new File(['%PDF-1.4\nfictional'], 'demo.pdf', { type: 'application/pdf' }));
    const upload = await app.request(
      'http://localhost/api/customers/demo-1/attachments',
      { method: 'POST', headers: { Cookie: cookie }, body: form },
      env,
    );
    const fileId = ((await upload.json()) as any).id;
    expect((await req('/customers/demo-1', 'DELETE')).status).toBe(200);
    expect(
      ((await (await req('/customers')).json()) as any[]).some((row) => row.id === 'demo-1'),
    ).toBe(false);
    expect(
      ((await (await req('/search?q=陈淑华')).json()) as any[]).some((row) => row.id === 'demo-1'),
    ).toBe(false);
    expect(
      ((await (await req('/followups')).json()) as any[]).some(
        (row) => row.customer_id === 'demo-1',
      ),
    ).toBe(false);
    expect(
      ((await (await req('/warranties')).json()) as any[]).some(
        (row) => row.customer_id === 'demo-1',
      ),
    ).toBe(false);
    expect((await req('/customers/demo-1/detail')).status).toBe(404);
    expect((await req('/files/' + fileId)).status).toBe(404);
    expect(
      ((await (await req('/customers/removed')).json()) as any[]).some(
        (row) => row.id === 'demo-1',
      ),
    ).toBe(true);
    expect((await req('/customers/demo-1/restore', 'POST')).status).toBe(200);
    expect((await req('/customers/demo-1/detail')).status).toBe(200);
    expect((await req('/files/' + fileId)).status).toBe(200);
  });
  it('检查、验配和随访可编辑且修改反映在档案和保修提醒中', async () => {
    const detail = (await (await req('/customers/demo-1/detail')).json()) as any;
    const exam = detail.exams[0],
      fitting = detail.fittings[0],
      followup = detail.followups[0];
    expect(
      (
        await req(`/customers/demo-1/exams/${exam.id}`, 'PUT', {
          ...exam,
          conclusion: '更正后的结论',
          right: exam.right.map((p: any, i: number) => (i === 0 ? { ...p, value: 55 } : p)),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req(`/customers/demo-1/fittings/${fitting.id}`, 'PUT', {
          ...fitting,
          serialLeft: 'DEMO-EDIT-L',
          serialRight: 'DEMO-EDIT-R',
          warranty: '2026-11-30',
          notes: '更正后的验配说明',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await req(`/customers/demo-1/followups/${followup.id}`, 'PUT', {
          ...followup,
          due: '2026-10-02',
          note: '更正后的随访计划',
        })
      ).status,
    ).toBe(200);
    const after = (await (await req('/customers/demo-1/detail')).json()) as any;
    expect(after.exams[0].conclusion).toBe('更正后的结论');
    expect(after.exams[0].right[0].value).toBe(55);
    expect(after.fittings[0]).toMatchObject({ warranty: '2026-11-30', notes: '更正后的验配说明' });
    expect(after.followups[0]).toMatchObject({ due: '2026-10-02', note: '更正后的随访计划' });
    const warranty = ((await (await req('/warranties')).json()) as any[]).find(
      (row) => row.id === fitting.id,
    );
    expect(warranty.warranty).toBe('2026-11-30');
    expect(after.audit.some((row: any) => row.action === '修改听力检查记录')).toBe(true);
  });
  it('随访可删除与恢复', async () => {
    const followupId = 'demo-1-follow';
    expect((await req(`/customers/demo-1/followups/${followupId}`, 'DELETE')).status).toBe(200);
    expect(
      ((await (await req('/followups')).json()) as any[]).some((row) => row.id === followupId),
    ).toBe(false);
    expect(
      ((await (await req('/customers/demo-1/removed')).json()) as any).followups.some(
        (row: any) => row.id === followupId,
      ),
    ).toBe(true);
    expect((await req(`/customers/demo-1/followups/${followupId}/restore`, 'POST')).status).toBe(
      200,
    );
    expect(
      ((await (await req('/followups')).json()) as any[]).some((row) => row.id === followupId),
    ).toBe(true);
    expect((await req('/login', 'POST', { role: '前台' })).status).toBe(400);
  });
  it('单页建档一次保存住址、独立联系人、听力图、验配和随访', async () => {
    const curve = () =>
      frequencies.map((frequency) => ({ frequency, value: 45, masked: false, noResponse: false }));
    const payload = {
      customer: {
        name: '一站式演示客户',
        gender: '女',
        birthDate: '1965-05-06',
        phone: '虚构号码',
        address: '虚构测试地址',
        contact: '家属（演示）',
        contactPhone: '虚构家属号码',
        source: '自然到店',
        status: '试戴中',
        history: '测试主诉',
        needs: '测试需求',
      },
      exam: {
        date: '2026-09-26',
        right: curve(),
        left: curve(),
        boneRight: curve(),
        boneLeft: curve(),
        speech: '测试言语',
        other: '测试其他',
        conclusion: '测试结论',
      },
      fitting: {
        date: '2026-09-26',
        brand: '峰力',
        series: 'Lumity',
        model: 'Audeo L50-R',
        side: '双耳',
        serialLeft: 'DEMO-NEW-L',
        serialRight: 'DEMO-NEW-R',
        amount: 5000,
        warranty: '2026-10-20',
        notes: '测试验配',
      },
      followup: { due: '2026-10-01', type: '适应回访', note: '测试回访' },
    };
    const response = await req('/intakes', 'POST', payload);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as any;
    const customer = ((await (await req('/customers')).json()) as any[]).find(
      (row) => row.id === id,
    );
    expect(customer).toMatchObject({
      address: '虚构测试地址',
      contact: '家属（演示）',
      contactPhone: '虚构家属号码',
    });
    const detail = (await (await req(`/customers/${id}/detail`)).json()) as any;
    expect(detail.exams).toHaveLength(1);
    expect(detail.fittings[0]).toMatchObject({ model: 'Audeo L50-R', warranty: '2026-10-20' });
    expect(detail.followups).toHaveLength(1);
    expect(
      ((await (await req('/warranties')).json()) as any[]).some((row) => row.customer_id === id),
    ).toBe(true);
    expect(
      ((await (await req('/search?q=' + encodeURIComponent('虚构家属号码'))).json()) as any[]).some(
        (row) => row.id === id,
      ),
    ).toBe(true);
  });
  it('一站式建档验证失败不会留下半份档案', async () => {
    const before = db.prepare('SELECT COUNT(*) count FROM customers').get() as any;
    const base = {
      name: '权限测试',
      gender: '未填写',
      birthDate: '1960-01-01',
      phone: '',
      contact: '',
      address: '',
      contactPhone: '',
      source: '自然到店',
      status: '待评估',
      history: '',
      needs: '',
    };
    expect(
      (await req('/intakes', 'POST', { customer: base, exam: { date: '2026-09-26' } })).status,
    ).toBe(400);
    const curve = () =>
      frequencies.map((frequency) => ({
        frequency,
        value: null,
        masked: false,
        noResponse: false,
      }));
    expect(
      (
        await req('/intakes', 'POST', {
          customer: base,
          exam: {
            date: '2026-09-26',
            right: curve(),
            left: curve(),
            boneRight: curve(),
            boneLeft: curve(),
            speech: '',
            other: '',
            conclusion: '测试',
          },
        })
      ).status,
    ).toBe(201);
    expect((db.prepare('SELECT COUNT(*) count FROM customers').get() as any).count).toBe(
      before.count + 1,
    );
    expect((await req('/intakes', 'POST', { customer: base })).status).toBe(201);
  });
  it('误录的检查和验配可删除并恢复，统计与搜索忽略已删除记录', async () => {
    const before = (await (await req('/customers/demo-1/detail')).json()) as any;
    const examId = before.exams[0].id,
      fittingId = before.fittings[0].id;
    expect((await req(`/customers/demo-1/exams/${examId}`, 'DELETE')).status).toBe(200);
    expect((await req(`/customers/demo-1/fittings/${fittingId}`, 'DELETE')).status).toBe(200);
    const after = (await (await req('/customers/demo-1/detail')).json()) as any;
    expect(after.exams).toHaveLength(0);
    expect(after.fittings).toHaveLength(0);
    const removed = (await (await req('/customers/demo-1/removed')).json()) as any;
    expect(removed.exams[0].id).toBe(examId);
    expect(removed.fittings[0].id).toBe(fittingId);
    expect(
      ((await (await req('/warranties')).json()) as any[]).some((row) => row.id === fittingId),
    ).toBe(false);
    expect((await req(`/customers/demo-1/exams/${examId}/restore`, 'POST')).status).toBe(200);
    expect((await req(`/customers/demo-1/fittings/${fittingId}/restore`, 'POST')).status).toBe(200);
    const restored = (await (await req('/customers/demo-1/detail')).json()) as any;
    expect(restored.exams).toHaveLength(1);
    expect(restored.fittings).toHaveLength(1);
  });
  it('手填型号与独立序列号支持创建、修改、检索，停用字典接口', async () => {
    const data = {
      date: '2026-09-26',
      brand: '',
      series: '',
      model: '手填型号 X1',
      side: '双耳',
      serialLeft: 'SN-LEFT-100',
      serialRight: 'SN-RIGHT-101',
      amount: 100,
      warranty: '',
      notes: '首次验配',
    };
    expect((await req('/device-catalog')).status).toBe(404);
    const created = await req('/customers/demo-1/fittings', 'POST', data);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as any;
    let detail = (await (await req('/customers/demo-1/detail')).json()) as any;
    expect(detail.fittings.find((r: any) => r.id === id)).toMatchObject(data);
    expect(
      (
        await req('/customers/demo-1/fittings/' + id, 'PUT', {
          ...data,
          model: '更正型号 X2',
          serialRight: 'SN-RIGHT-102',
        })
      ).status,
    ).toBe(200);
    detail = (await (await req('/customers/demo-1/detail')).json()) as any;
    expect(detail.fittings.find((r: any) => r.id === id).model).toBe('更正型号 X2');
    expect(
      ((await (await req('/search?q=SN-RIGHT-102')).json()) as any[]).some(
        (c) => c.id === 'demo-1',
      ),
    ).toBe(true);
    expect(
      (await req('/customers/demo-1/fittings', 'POST', { ...data, serialRight: '' })).status,
    ).toBe(201);
    expect(
      (await req('/customers/demo-1/fittings', 'POST', { ...data, serialRight: 'sn-left-100' }))
        .status,
    ).toBe(400);
    expect(
      (await req('/customers/demo-1/fittings', 'POST', { ...data, side: '左耳', serialRight: '' }))
        .status,
    ).toBe(201);
  });
  it('未知生日、设备型号与序列号及服务描述可先留空再补录', async () => {
    const customer = {
      name: '待补资料客户',
      gender: '未填写',
      birthDate: '',
      phone: '',
      source: '',
      status: '待评估',
    };
    const fitting = {
      date: '2026-09-27',
      model: '',
      side: '双耳',
      amount: 0,
      warranty: '',
      notes: '',
    };
    const intake = await req('/intakes', 'POST', {
      customer,
      fitting,
      followup: { due: '2026-10-01', type: '适应回访', note: '' },
    });
    expect(intake.status).toBe(201);
    const { id } = (await intake.json()) as any;
    const detail = (await (await req(`/customers/${id}/detail`)).json()) as any;
    expect(detail.fittings[0]).toMatchObject({
      model: '',
      serialLeft: '',
      serialRight: '',
      notes: '',
    });
    expect(detail.followups[0].note).toBe('');
    expect(
      ((await (await req('/customers')).json()) as any[]).find((row) => row.id === id).birthDate,
    ).toBe('');
    const repair = await req(`/customers/${id}/repairs`, 'POST', {
      fittingId: detail.fittings[0].id,
      occurredDate: '2026-09-27',
      receivedDate: '',
      completedDate: '',
      status: '已完成',
      problem: '',
      findings: '',
      workDone: '',
      parts: '',
      price: 0,
      warrantyCovered: false,
      notes: '',
    });
    expect(repair.status).toBe(201);
    expect(
      (await req(`/customers/${id}/profile`, 'PUT', { ...customer, birthDate: '1975-03-02' }))
        .status,
    ).toBe(200);
  });
  it('跨客户资料、检查结论、设备及随访搜索，并按门店隔离', async () => {
    const cases: [string, string][] = [
      ['陈淑华', 'demo-1'],
      ['家人交谈', 'demo-1'],
      ['个体化试戴计划', 'demo-1'],
      ['Audeo L50-R', 'demo-1'],
      ['佩戴时长', 'demo-1'],
    ];
    for (const [term, id] of cases) {
      const response = await req('/search?q=' + encodeURIComponent(term));
      expect(response.status).toBe(200);
      expect(((await response.json()) as any[]).some((row) => row.id === id)).toBe(true);
    }
    const literalPercent = (await (await req('/search?q=%25')).json()) as any[];
    expect(literalPercent).toHaveLength(9);
    expect(literalPercent.every((row) => row.id !== 'demo-4')).toBe(true);
    expect((await req('/search?q=' + encodeURIComponent('听'.repeat(17)))).status).toBe(400);
    await switchToNewStore();
    expect(await (await req('/search?q=' + encodeURIComponent('陈淑华'))).json()).toEqual([]);
  });
  it('报告上传后仅本门店登录用户可下载', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File(['%PDF-1.4\nfictional test report'], 'test.pdf', { type: 'application/pdf' }),
    );
    const uploaded = await app.request(
      'http://localhost/api/customers/demo-1/attachments',
      { method: 'POST', headers: { Cookie: cookie }, body: form },
      env,
    );
    expect(uploaded.status).toBe(201);
    const { id } = (await uploaded.json()) as any;
    const download = await req('/files/' + id);
    expect(download.status).toBe(200);
    expect(download.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await download.text()).toContain('%PDF');
    await switchToNewStore();
    expect((await req('/files/' + id)).status).toBe(404);
    cookie = '';
    expect((await req('/files/' + id)).status).toBe(401);
  });
  it('拒绝伪装成图片的文本附件', async () => {
    const form = new FormData();
    form.append('file', new File(['not an image'], 'bad.png', { type: 'image/png' }));
    const r = await app.request(
      'http://localhost/api/customers/demo-1/attachments',
      { method: 'POST', headers: { Cookie: cookie }, body: form },
      env,
    );
    expect(r.status).toBe(400);
  });
  it('未登录不能读取客户', async () => {
    cookie = '';
    expect((await req('/customers')).status).toBe(401);
  });
  it('关闭 DEMO_MODE 后禁止公开演示登录', async () => {
    env.DEMO_MODE = 'false';
    expect((await req('/login', 'POST', { role: '店主' })).status).toBe(403);
  });
  it('建档、编辑、读取及审计记录可以持久保存', async () => {
    const d = {
      name: '测试客户',
      gender: '未填写',
      birthDate: '1960-01-01',
      phone: '演示号码',
      contact: '',
      source: '自然到店',
      status: '待评估',
      history: '',
      needs: '',
    };
    const r = await req('/customers', 'POST', d);
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as any;
    expect((await req(`/customers/${id}/profile`, 'PUT', { ...d, status: '试戴中' })).status).toBe(
      200,
    );
    const list = (await (await req('/customers')).json()) as any[];
    expect(list.find((c) => c.id === id).status).toBe('试戴中');
    const detail = (await (await req(`/customers/${id}/detail`)).json()) as any;
    expect(detail.audit.length).toBe(2);
  });
  it('检查写入并正确读取掩蔽和无反应状态', async () => {
    const p = () =>
      frequencies.map((f) => ({ frequency: f, value: 40, noResponse: false, masked: false }));
    const ex = {
      date: '2026-09-26',
      right: p(),
      left: p(),
      boneRight: p(),
      boneLeft: p(),
      speech: '',
      other: '',
      conclusion: '虚构检查',
    };
    ex.right[0].noResponse = true;
    ex.left[1].masked = true;
    const r = await req('/customers/demo-1/exams', 'POST', ex);
    expect(r.status).toBe(201);
    const detail = (await (await req('/customers/demo-1/detail')).json()) as any;
    const saved = detail.exams.find((e: any) => e.conclusion === '虚构检查');
    expect(saved.right[0].noResponse).toBe(true);
    expect(saved.left[1].masked).toBe(true);
  });
  it('已取消的身份不能登录，旧会话也不能访问数据', async () => {
    for (const role of ['前台', '验配师']) {
      expect((await req('/login', 'POST', { role })).status).toBe(400);
      db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
        'legacy-' + encodeURIComponent(role),
        role,
        'demo-store',
        Date.now() + 10000,
      );
      cookie = 'hearing_session=legacy-' + encodeURIComponent(role);
      expect((await req('/customers')).status).toBe(401);
      expect((await req('/export')).status).toBe(401);
    }
  });
  it('其他门店不能读取、修改客户或完成随访', async () => {
    const created = await req('/accounts/stores', 'POST', { name: '第二门店' });
    expect(created.status).toBe(201);
    const { id } = await created.json() as any;
    const switched = await req('/accounts/stores/' + id + '/switch', 'POST');
    expect(switched.status).toBe(200);
    cookie += '; ' + switched.headers.get('Set-Cookie')!.split(';')[0];
    expect(await (await req('/customers')).json()).toEqual([]);
    expect((await req('/customers/demo-1/detail')).status).toBe(404);
    expect((await req('/customers/demo-1/profile', 'PUT', {})).status).toBe(404);
    expect((await req('/followups/demo-1-follow', 'PUT', { result: '测试' })).status).toBe(404);
  });
  it('门店名称与账户状态按门店保存，切换后只读取当前门店', async () => {
    expect((await req('/accounts/presence', 'POST')).status).toBe(200);
    expect(((await (await req('/accounts')).json()) as any[])[0].online).toBe(true);
    expect((await req('/accounts/stores/demo-store', 'PATCH', { name: '新名称' })).status).toBe(200);
    expect(((await (await req('/me')).json()) as any).storeName).toBe('新名称');
    const created = await req('/accounts/stores', 'POST', { name: '分店' });
    const { id } = await created.json() as any;
    const switched = await req('/accounts/stores/' + id + '/switch', 'POST');
    cookie += '; ' + switched.headers.get('Set-Cookie')!.split(';')[0];
    expect(((await (await req('/me')).json()) as any).tenant_id).toBe(id);
    expect(await (await req('/customers')).json()).toEqual([]);
    expect((await req('/customers/demo-1/detail')).status).toBe(404);
    expect(((await (await req('/accounts/stores')).json()) as any[]).map((s) => s.name))
      .toEqual(['分店', '新名称']);
  });
  it('Excel 数据只包含本门店有效档案，最新听力排除误删检查，关联记录随客户隐藏', async () => {
    db.prepare('INSERT INTO exams(id,tenant_id,customer_id,date,data) VALUES(?,?,?,?,?)').run(
      'latest-exam',
      'demo-store',
      'demo-1',
      '2026-09-27',
      JSON.stringify({ right: [], left: [], conclusion: '最近检查' }),
    );
    db.prepare(
      'INSERT INTO exams(id,tenant_id,customer_id,date,data,deleted_at) VALUES(?,?,?,?,?,?)',
    ).run('removed-exam', 'demo-store', 'demo-1', '2026-09-28', '{}', '2026-09-28 10:00:00');
    const exported = (await (await req('/export/spreadsheet')).json()) as any;
    expect(exported.customers.some((row: any) => row.id === 'demo-1')).toBe(true);
    expect(
      exported.exams.filter((row: any) => row.customer_id === 'demo-1').map((row: any) => row.id),
    ).toEqual(['latest-exam']);
    expect(exported.fittings.some((row: any) => row.customer_id === 'demo-1')).toBe(true);
    expect(exported.customers[0]).not.toHaveProperty('history');
    db.prepare('UPDATE customers SET deleted_at=? WHERE id=?').run('2026-09-28 10:00:00', 'demo-1');
    const after = (await (await req('/export/spreadsheet')).json()) as any;
    for (const key of ['customers', 'exams', 'fittings', 'repairs', 'followups']) {
      expect(
        after[key].some((row: any) => row.id === 'demo-1' || row.customer_id === 'demo-1'),
      ).toBe(false);
    }
    await switchToNewStore();
    expect(((await (await req('/export/spreadsheet')).json()) as any).customers).toEqual([]);
    cookie = '';
    expect((await req('/export/spreadsheet')).status).toBe(401);
  });
  it('拒绝跨站写请求', async () => {
    expect(
      (await req('/login', 'POST', { role: '店主' }, { Origin: 'https://evil.example' })).status,
    ).toBe(403);
  });
  it('完成随访必须写入结果并留下审计', async () => {
    expect((await req('/followups/demo-1-follow', 'PUT', { result: '' })).status).toBe(400);
    expect(
      (await req('/followups/demo-1-follow', 'PUT', { result: '佩戴舒适，继续随访。' })).status,
    ).toBe(200);
    const r = (await (await req('/followups')).json()) as any[];
    expect(r.find((f) => f.id === 'demo-1-follow').completed).toBe(1);
  });
  it('退出后会话失效', async () => {
    await req('/logout', 'POST');
    expect((await req('/customers')).status).toBe(401);
  });
});
