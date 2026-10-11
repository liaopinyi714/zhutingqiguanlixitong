import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { attachmentRoutes } from '../server/attachments';
import type { AppContext } from '../server/types';

let db: DatabaseSync, env: any;
let files: Map<string, ArrayBuffer>, errors: Error[];
const app = new Hono<AppContext>();
app.use('*', async (c, next) => {
  c.set('session', {
    role: '店主',
    tenant_id: 'test-store',
    email: 'owner@example.com',
    name: '测试店主',
    storeName: '测试门店',
    actor: '测试店主',
  });
  return next();
});
app.onError((error, c) => {
  errors.push(error);
  return c.json({ error: '上传失败' }, 500);
});
app.route('/api', attachmentRoutes);

function statement(sql: string, args: any[] = []): any {
  return {
    bind: (...values: any[]) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  };
}
function upload() {
  const form = new FormData();
  form.append(
    'file',
    new File(['%PDF-1.4\nfictional'], '测试报告.pdf', { type: 'application/pdf' }),
  );
  return app.request(
    'http://localhost/api/customers/test-customer/attachments',
    {
      method: 'POST',
      body: form,
    },
    env,
  );
}
const rows = () => db.prepare('SELECT id,object_key FROM attachments').all();

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations-production')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    db.exec(readFileSync('migrations-production/' + file, 'utf8'));
  db.exec(`
    INSERT INTO stores(id,name) VALUES('test-store','测试门店');
    INSERT INTO store_memberships(email,tenant_id,name,enabled,source)
      VALUES('owner@example.com','test-store','测试店主',1,'managed');
    INSERT INTO customers(id,tenant_id,name,gender,birth_date,phone,source,status)
      VALUES('test-customer','test-store','虚构客户','未填写','','','','待评估');
  `);
  files = new Map();
  errors = [];
  env = {
    DB: {
      prepare: statement,
      batch: async (statements: any[]) => {
        db.exec('BEGIN');
        try {
          const result = [];
          for (const statement of statements) result.push(await statement.all());
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
    FILES: {
      put: async (key: string, bytes: ArrayBuffer) => files.set(key, bytes),
      get: async (key: string) => (files.has(key) ? { body: files.get(key) } : null),
      delete: async (key: string) => files.delete(key),
    },
  };
});
afterEach(() => db.close());

describe('报告上传失败后的补偿', () => {
  it('D1 提交成功但响应丢失时保留文件，已有附件仍能下载', async () => {
    const write = env.DB.batch;
    const failure = new Error('Commit response lost');
    env.DB.batch = async (statements: any[]) => {
      await write(statements);
      throw failure;
    };
    expect((await upload()).status).toBe(500);
    expect(errors).toEqual([failure]);
    expect(rows()).toHaveLength(1);
    const [saved] = rows();
    expect(files.has(saved.object_key as string)).toBe(true);
    const download = await app.request('http://localhost/api/files/' + saved.id, {}, env);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('%PDF-1.4\nfictional');
    expect(db.prepare('SELECT COUNT(*) n FROM audit').get()!.n).toBe(1);
  });

  it('D1 确认没有写入目录时删除上传文件', async () => {
    const failure = new Error('Commit failed before writing');
    env.DB.batch = async () => {
      throw failure;
    };
    expect((await upload()).status).toBe(500);
    expect(errors).toEqual([failure]);
    expect(rows()).toEqual([]);
    expect(files.size).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM audit').get()!.n).toBe(0);
  });

  it.each([false, true])('核查也失败时保留文件和原错误（实际提交：%s）', async (committed) => {
    const write = env.DB.batch;
    const failure = new Error('Commit result unknown');
    env.DB.batch = async (statements: any[]) => {
      if (committed) await write(statements);
      env.DB.prepare = () => {
        throw new Error('Verification unavailable');
      };
      throw failure;
    };
    expect((await upload()).status).toBe(500);
    expect(errors).toEqual([failure]);
    expect(rows()).toHaveLength(committed ? 1 : 0);
    expect(files.size).toBe(1);
  });

  it('补偿删除失败时保留最初的写入错误', async () => {
    const failure = new Error('Original write failure');
    env.DB.batch = async () => {
      throw failure;
    };
    env.FILES.delete = async () => {
      throw new Error('Cleanup unavailable');
    };
    expect((await upload()).status).toBe(500);
    expect(errors).toEqual([failure]);
    expect(rows()).toEqual([]);
    expect(files.size).toBe(1);
  });
});
