import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import app from '../server/index';
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
      delete: async (key: string) => files.delete(key),
    },
  };
  cookie = '';
  const login = await req('/login', 'POST', { role: '店主' });
  cookie = login.headers.get('Set-Cookie')!.split(';')[0];
});
describe('演示 API', () => {
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
