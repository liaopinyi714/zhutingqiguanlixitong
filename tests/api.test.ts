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
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_schema.sql', 'utf8'));
  db.exec(readFileSync('migrations/0002_demo_seed.sql', 'utf8'));
  db.exec(readFileSync('migrations/0003_device_catalog.sql', 'utf8'));
  db.exec(readFileSync('migrations/0004_intake_and_corrections.sql', 'utf8'));
  db.exec(readFileSync('migrations/0005_record_lifecycle.sql', 'utf8'));
  db.exec(readFileSync('migrations/0006_attachment_retention.sql', 'utf8'));
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
  it('报告删除后无法下载，30 天内可恢复，前台无权删除', async () => {
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
    const frontdesk = await req('/login', 'POST', { role: '前台' });
    const ownerCookie = cookie;
    cookie = frontdesk.headers.get('Set-Cookie')!.split(';')[0];
    expect((await req(`/customers/demo-1/attachments/${fileId}`, 'DELETE')).status).toBe(403);
    cookie = ownerCookie;
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
  it('随访可删除与恢复，前台不能删除客户或编辑专业检查', async () => {
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
    const login = await req('/login', 'POST', { role: '前台' });
    cookie = login.headers.get('Set-Cookie')!.split(';')[0];
    expect((await req('/customers/demo-1', 'DELETE')).status).toBe(403);
    expect((await req('/customers/removed')).status).toBe(403);
    const exam = ((await (await req('/customers/demo-1/detail')).json()) as any).exams[0];
    expect((await req(`/customers/demo-1/exams/${exam.id}`, 'PUT', exam)).status).toBe(403);
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
        deviceModelId: 'demo-model-audeo',
        brand: '峰力',
        series: 'Lumity',
        model: 'Audeo L50-R',
        side: '双耳',
        serial: 'DEMO-NEW',
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
  it('前台不能通过一站式建档绕过专业录入权限，错误不会留下半份档案', async () => {
    const login = await req('/login', 'POST', { role: '前台' });
    cookie = login.headers.get('Set-Cookie')!.split(';')[0];
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
    ).toBe(403);
    expect((db.prepare('SELECT COUNT(*) count FROM customers').get() as any).count).toBe(
      before.count,
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
  it('型号字典按品牌、系列、型号管理，验配引用字典并保留历史名称', async () => {
    const initial = (await (await req('/device-catalog')).json()) as any;
    expect(initial.brands).toHaveLength(3);
    const brand = await req('/device-catalog/brands', 'POST', { name: '测试品牌' });
    expect(brand.status).toBe(201);
    const brandId = ((await brand.json()) as any).id;
    expect((await req('/device-catalog/brands', 'POST', { name: '测试品牌' })).status).toBe(409);
    const series = await req('/device-catalog/series', 'POST', { brandId, name: '体验系列' });
    expect(series.status).toBe(201);
    const seriesId = ((await series.json()) as any).id;
    const model = await req('/device-catalog/models', 'POST', { seriesId, name: 'BTE 100' });
    expect(model.status).toBe(201);
    const modelId = ((await model.json()) as any).id;
    const fitting = await req('/customers/demo-1/fittings', 'POST', {
      date: '2026-09-26',
      deviceModelId: modelId,
      brand: '伪造品牌',
      model: '伪造型号',
      side: '双耳',
      serial: 'DEMO-TEST',
      amount: 100,
      warranty: '',
      notes: '演示字典选择',
    });
    expect(fitting.status).toBe(201);
    const detail = (await (await req('/customers/demo-1/detail')).json()) as any;
    expect(detail.fittings[0]).toMatchObject({
      brand: '测试品牌',
      series: '体验系列',
      model: 'BTE 100',
      deviceModelId: modelId,
    });
    const foundBySeries = (await (
      await req('/search?q=' + encodeURIComponent('体验系列'))
    ).json()) as any[];
    expect(foundBySeries.some((row) => row.id === 'demo-1')).toBe(true);
    expect(
      (await req('/device-catalog/models/' + modelId, 'PUT', { name: 'BTE 200' })).status,
    ).toBe(200);
    const unchanged = (await (await req('/customers/demo-1/detail')).json()) as any;
    expect(unchanged.fittings[0].model).toBe('BTE 100');
    expect((await req('/device-catalog/brands/' + brandId, 'DELETE')).status).toBe(200);
    const visible = (await (await req('/device-catalog')).json()) as any;
    expect(visible.models.some((row: any) => row.id === modelId)).toBe(false);
    const invalid = await req('/customers/demo-1/fittings', 'POST', {
      date: '2026-09-26',
      deviceModelId: modelId,
      brand: '测试品牌',
      model: 'BTE 200',
      side: '双耳',
      serial: '',
      amount: 0,
      warranty: '',
      notes: '测试停用',
    });
    expect(invalid.status).toBe(400);
  });
  it('型号字典仅店主可维护且跨门店不可引用', async () => {
    const login = await req('/login', 'POST', { role: '验配师' });
    cookie = login.headers.get('Set-Cookie')!.split(';')[0];
    expect((await req('/device-catalog/brands', 'POST', { name: '无权限' })).status).toBe(403);
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
      'other-token',
      '店主',
      'other-store',
      Date.now() + 10000,
    );
    cookie = 'hearing_session=other-token';
    expect(((await (await req('/device-catalog')).json()) as any).brands).toEqual([]);
    expect(
      (await req('/device-catalog/series', 'POST', { brandId: 'demo-brand-phonak', name: '越权' }))
        .status,
    ).toBe(400);
    expect((await req('/device-catalog/models/demo-model-audeo', 'DELETE')).status).toBe(404);
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
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
      'other-token',
      '店主',
      'other-store',
      Date.now() + 10000,
    );
    cookie = 'hearing_session=other-token';
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
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
      'other-token',
      '店主',
      'other-store',
      Date.now() + 10000,
    );
    cookie = 'hearing_session=other-token';
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
  it('前台在服务端不能越权写入专业记录或导出', async () => {
    const login = await req('/login', 'POST', { role: '前台' });
    cookie = login.headers.get('Set-Cookie')!.split(';')[0];
    expect((await req('/customers/demo-1/exams', 'POST', {})).status).toBe(403);
    expect((await req('/customers/demo-1/fittings', 'POST', {})).status).toBe(403);
    expect((await req('/export')).status).toBe(403);
  });
  it('其他门店不能读取、修改客户或完成随访', async () => {
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
      'other-token',
      '店主',
      'other-store',
      Date.now() + 10000,
    );
    cookie = 'hearing_session=other-token';
    expect(await (await req('/customers')).json()).toEqual([]);
    expect((await req('/customers/demo-1/detail')).status).toBe(404);
    expect((await req('/customers/demo-1/profile', 'PUT', {})).status).toBe(404);
    expect((await req('/followups/demo-1-follow', 'PUT', { result: '测试' })).status).toBe(404);
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
