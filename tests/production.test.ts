import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { app } from '../server/index';
import { readStaffAccounts } from '../server/auth';
import { configErrors, readConfig } from '../scripts/production-config.mjs';

let db: DatabaseSync,
  env: any,
  privateKey: CryptoKey,
  publicKey: any,
  sequence = 0;
const origin = 'https://hearing-care.example.com';
const audience = 'a'.repeat(64);
const owner = {
  email: 'owner@example.com',
  name: '负责人',
  role: '店主',
  tenantId: 'store-001',
  storeName: '测试门店',
};
const profile = {
  name: '测试客户',
  gender: '未填写',
  birthDate: '1960-01-01',
  phone: '虚构号码',
  source: '自然到店',
  status: '待评估',
};
function statement(sql: string, args: any[] = []): any {
  return {
    bind: (...values: any[]) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ success: true, meta: db.prepare(sql).run(...args) }),
  };
}
beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  publicKey = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
});
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations-production')
    .filter((s) => s.endsWith('.sql'))
    .sort())
    db.exec(readFileSync(`migrations-production/${file}`, 'utf8'));
  env = {
    DEMO_MODE: 'false',
    ACCESS_TEAM_DOMAIN: `test-${++sequence}.cloudflareaccess.com`,
    ACCESS_AUD: audience,
    STAFF_ACCOUNTS: JSON.stringify([owner]),
    DB: {
      prepare: statement,
      batch: async (statements: any[]) => {
        db.exec('BEGIN');
        try {
          const rows = [];
          for (const s of statements) rows.push(await s.all());
          db.exec('COMMIT');
          return rows;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      expect(String(url)).toBe(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
      return Response.json({ keys: [publicKey] });
    }),
  );
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});
async function token(claims: Record<string, unknown> = {}, key = privateKey) {
  return new SignJWT({ email: owner.email, type: 'app', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`)
    .setAudience(audience)
    .setSubject('employee-id')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}
async function req(
  path: string,
  jwt?: string,
  method = 'GET',
  data?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(
    origin + '/api' + path,
    {
      method,
      headers: {
        Origin: origin,
        'X-Requested-With': 'hearing-care',
        'Content-Type': 'application/json',
        ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}),
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
    env,
  );
}
describe('正式环境', () => {
  it('新数据库没有任何演示客户、字典或会话', () => {
    for (const table of [
      'customers',
      'exams',
      'fittings',
      'followups',
      'attachments',
      'sessions',
      'device_brands',
      'device_series',
      'device_models',
    ])
      expect((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n).toBe(0);
    expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  });
  it('公网禁止演示登录，即使误设 DEMO_MODE=true 或持有旧演示 cookie', async () => {
    env.DEMO_MODE = 'true';
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
      'demo-token',
      '店主',
      'demo-store',
      Date.now() + 86400000,
    );
    expect((await req('/login', undefined, 'POST', { role: '店主' })).status).toBe(403);
    expect(
      (
        await req('/customers', undefined, 'GET', undefined, {
          Cookie: 'hearing_session=demo-token',
          'Cf-Access-Authenticated-User-Email': owner.email,
        })
      ).status,
    ).toBe(401);
    expect(await (await req('/config')).json()).toEqual({ demo: false });
  });
  it('验证 JWT 后只采用服务端员工权限，并记录具体操作人', async () => {
    const jwt = await token({ role: '任意角色', tenant_id: 'attacker-store' });
    const me = (await (await req('/me', jwt)).json()) as any;
    expect(me.role).toBe('店主');
    expect(me.tenant_id).toBe(owner.tenantId);
    const saved = await req('/customers', jwt, 'POST', profile);
    expect(saved.status).toBe(201);
    const audit = db.prepare('SELECT * FROM audit').get() as any;
    expect(audit.actor).toBe('负责人 <owner@example.com>');
    expect(audit.tenant_id).toBe(owner.tenantId);
  });
  it('拒绝错误签名、过期、错误 audience 和 issuer 的令牌', async () => {
    const wrongKey = (await generateKeyPair('RS256')).privateKey;
    expect((await req('/me', await token({}, wrongKey))).status).toBe(401);
    const make = () =>
      new SignJWT({ email: owner.email, type: 'app' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setSubject('employee')
        .setIssuedAt();
    for (const jwt of [
      await make()
        .setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`)
        .setAudience(audience)
        .setExpirationTime(946684800)
        .sign(privateKey),
      await make()
        .setIssuer(`https://${env.ACCESS_TEAM_DOMAIN}`)
        .setAudience('wrong')
        .setExpirationTime('1h')
        .sign(privateKey),
      await make()
        .setIssuer('https://untrusted.example.com')
        .setAudience(audience)
        .setExpirationTime('1h')
        .sign(privateKey),
    ])
      expect((await req('/me', jwt)).status).toBe(401);
  });
  it('未授权或被移除的员工即使仍有有效 JWT 也无法访问', async () => {
    const jwt = await token();
    expect((await req('/me', jwt)).status).toBe(200);
    env.STAFF_ACCOUNTS = JSON.stringify([{ ...owner, email: 'replacement@example.com' }]);
    expect((await req('/me', jwt)).status).toBe(403);
  });
  it('前台专业权限与跨门店隔离在正式身份下仍然生效', async () => {
    const jwt = await token();
    const saved = (await (await req('/customers', jwt, 'POST', profile)).json()) as any;
    env.STAFF_ACCOUNTS = JSON.stringify([{ ...owner, role: '前台' }]);
    expect((await req(`/customers/${saved.id}/exams`, jwt, 'POST', {})).status).toBe(403);
    expect((await req('/export', jwt)).status).toBe(403);
    env.STAFF_ACCOUNTS = JSON.stringify([{ ...owner, tenantId: 'store-002' }]);
    expect(await (await req('/customers', jwt)).json()).toEqual([]);
    expect((await req(`/customers/${saved.id}/detail`, jwt)).status).toBe(404);
  });
  it('拒绝跨站写入、缺少校验头及过大请求', async () => {
    const jwt = await token();
    expect(
      (await req('/customers', jwt, 'POST', profile, { Origin: 'https://attacker.example' }))
        .status,
    ).toBe(403);
    expect((await req('/customers', jwt, 'POST', profile, { 'X-Requested-With': '' })).status).toBe(
      403,
    );
    expect((await req('/customers', jwt, 'POST', { text: 'a'.repeat(130 * 1024) })).status).toBe(
      413,
    );
    expect((db.prepare('SELECT COUNT(*) n FROM customers').get() as any).n).toBe(0);
  });
  it('认证配置缺失时拒绝访问，注销使用 Access 会话退出入口', async () => {
    const jwt = await token();
    expect(await (await req('/logout', jwt, 'POST')).json()).toEqual({
      ok: true,
      logoutUrl: '/cdn-cgi/access/logout',
    });
    env.ACCESS_AUD = '';
    expect((await req('/me', jwt)).status).toBe(503);
  });
  it('拒绝重复邮箱、错误角色及演示门店授权', () => {
    expect(() => readStaffAccounts(JSON.stringify([owner, owner]))).toThrow();
    expect(() => readStaffAccounts(JSON.stringify([{ ...owner, role: '管理员' }]))).toThrow();
    expect(() =>
      readStaffAccounts(JSON.stringify([{ ...owner, tenantId: 'demo-store' }])),
    ).toThrow();
  });
  it('部署检查拒绝空配置、演示迁移和开启预览', () => {
    const config = readConfig();
    config.account_id = '';
    expect(configErrors(config).length).toBeGreaterThan(0);
    config.account_id = 'b'.repeat(32);
    config.vars.ACCESS_TEAM_DOMAIN = 'test.cloudflareaccess.com';
    config.vars.ACCESS_AUD = audience;
    config.d1_databases[0].database_id = '11111111-1111-4111-8111-111111111111';
    expect(configErrors(config)).toEqual([]);
    config.d1_databases[0].migrations_dir = 'migrations';
    config.preview_urls = true;
    expect(configErrors(config)).toHaveLength(2);
  });
});
