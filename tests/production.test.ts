import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { app } from '../server/index';
import { readStaffAccounts } from '../server/auth';
import { purgeExpiredRecords } from '../server/retention';
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
  it('移除初始门店配置不改变已有成员关系，账户和门店权限独立', async () => {
    const jwt = await token();
    await req('/me', jwt);
    env.STAFF_ACCOUNTS = JSON.stringify([{ email: owner.email, name: owner.name, role: '店主' }]);
    expect((await (await req('/me', jwt)).json() as any).tenant_id).toBe(owner.tenantId);
    expect((await req('/customers', jwt)).status).toBe(200);
    await purgeExpiredRecords(env);
    expect((db.prepare('SELECT abandoned_at FROM stores WHERE id=?').get(owner.tenantId) as any).abandoned_at).toBeNull();
  });
  it('迁移保留原门店、成员和姓名头像，优先采用初始门店资料', () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      for (const file of readdirSync('migrations-production').filter((s) => s.endsWith('.sql') && !s.startsWith('0007')).sort())
        legacy.exec(readFileSync('migrations-production/' + file, 'utf8'));
      legacy.prepare("INSERT INTO accounts(email,tenant_id,name,store_name,source) VALUES(?,?,?,?,'config')")
        .run(owner.email, owner.tenantId, '初始姓名', owner.storeName);
      legacy.prepare('INSERT INTO stores(id,name) VALUES(?,?)').run(owner.tenantId, owner.storeName);
      legacy.prepare("INSERT INTO store_memberships(email,tenant_id,name,source,avatar) VALUES(?,?,?,'config',?)")
        .run(owner.email, owner.tenantId, '更新姓名', '旧头像');
      legacy.exec(readFileSync('migrations-production/0007_independent_accounts.sql', 'utf8'));
      const profile = legacy.prepare('SELECT name,avatar FROM accounts WHERE email=?').get(owner.email) as any;
      expect(profile.name).toBe('更新姓名');
      expect(profile.avatar).toBe('旧头像');
      expect((legacy.prepare('SELECT enabled,left_at FROM store_memberships').get() as any).enabled).toBe(1);
      expect((legacy.prepare('SELECT enabled,left_at FROM store_memberships').get() as any).left_at).toBeNull();
      expect((legacy.prepare('SELECT id FROM stores').get() as any).id).toBe(owner.tenantId);
    } finally { legacy.close(); }
  });
  it('后台撤销最后一位成员后，门店经过保留期清理，旧账户不能靠数据库重新登录', async () => {
    const jwt = await token();
    await req('/customers', jwt, 'POST', profile);
    env.STAFF_ACCOUNTS = JSON.stringify([{ email: 'replacement@example.com', name: '替代账户', role: '店主' }]);
    const now = new Date();
    await purgeExpiredRecords(env, now);
    expect((db.prepare('SELECT abandoned_at FROM stores WHERE id=?').get(owner.tenantId) as any).abandoned_at).toBeTruthy();
    expect((db.prepare('SELECT COUNT(*) n FROM customers').get() as any).n).toBe(1);
    await purgeExpiredRecords(env, new Date(now.getTime() + 31 * 86400000));
    expect((db.prepare('SELECT COUNT(*) n FROM customers').get() as any).n).toBe(0);
    expect((await req('/me', jwt)).status).toBe(403);
    env.STAFF_ACCOUNTS = JSON.stringify([owner]);
    expect((await (await req('/me', jwt)).json() as any).tenant_id).toBe('');
    expect((await req('/accounts/stores/' + owner.tenantId + '/restore', jwt, 'POST')).status).toBe(404);
  });
  it('缺失或损坏后台名单不能被当作无人管理而误删门店', async () => {
    const jwt = await token();
    await req('/customers', jwt, 'POST', profile);
    env.STAFF_ACCOUNTS = 'invalid';
    await expect(purgeExpiredRecords(env)).rejects.toThrow();
    expect((db.prepare('SELECT abandoned_at FROM stores WHERE id=?').get(owner.tenantId) as any).abandoned_at).toBeNull();
    expect((db.prepare('SELECT COUNT(*) n FROM customers').get() as any).n).toBe(1);
    env.STAFF_ACCOUNTS = undefined;
    await purgeExpiredRecords(env);
    expect((db.prepare('SELECT abandoned_at FROM stores WHERE id=?').get(owner.tenantId) as any).abandoned_at).toBeNull();
  });
  it('后台可提供不关联门店的账户，只能使用个人页面和创建门店', async () => {
    env.STAFF_ACCOUNTS = JSON.stringify([{ email: owner.email, name: owner.name, role: '店主' }]);
    const jwt = await token();
    const me = await (await req('/me', jwt)).json() as any;
    expect(me.tenant_id).toBe('');
    expect(await (await req('/accounts/stores', jwt)).json()).toEqual([]);
    expect((await req('/accounts', jwt, 'PUT', { email: owner.email, name: '独立账户', enabled: true })).status).toBe(200);
    for (const path of ['/customers', '/export', '/devices', '/repairs', '/search?q=a'])
      expect((await req(path, jwt)).status).toBe(403);
    expect((await req('/customers', jwt, 'POST', profile)).status).toBe(403);
    const created = await (await req('/accounts/stores', jwt, 'POST', { name: '第一家店' })).json() as any;
    expect((await req('/accounts/stores/' + created.id + '/switch', jwt, 'POST')).status).toBe(200);
    expect((await (await req('/me', jwt)).json() as any).name).toBe('独立账户');
  });
  it('退出仅撤销自己的权限，恢复仅本人有效，停用能撤销恢复资格', async () => {
    const second = { ...owner, email: 'second@example.com', name: '同事' };
    env.STAFF_ACCOUNTS = JSON.stringify([owner, second]);
    const jwt = await token(), secondJwt = await token({ email: second.email });
    await req('/me', jwt);
    expect((await req('/accounts/stores/' + owner.tenantId + '/leave', secondJwt, 'POST')).status).toBe(200);
    expect((await (await req('/me', secondJwt)).json() as any).tenant_id).toBe('');
    expect((await req('/customers', secondJwt)).status).toBe(403);
    expect((await req('/customers', jwt)).status).toBe(200);
    expect((db.prepare('SELECT abandoned_at FROM stores WHERE id=?').get(owner.tenantId) as any).abandoned_at).toBeNull();
    expect((await req('/accounts/stores/' + owner.tenantId + '/rejoin', jwt, 'POST')).status).toBe(403);
    expect((await req('/accounts/stores/' + owner.tenantId + '/rejoin', secondJwt, 'POST')).status).toBe(200);
    await req('/accounts/stores/' + owner.tenantId + '/leave', secondJwt, 'POST');
    expect((await req('/accounts', jwt, 'PUT', { email: second.email, enabled: false })).status).toBe(200);
    expect((await req('/accounts/stores/' + owner.tenantId + '/rejoin', secondJwt, 'POST')).status).toBe(403);
    expect(await (await req('/accounts/stores/left', secondJwt)).json()).toEqual([]);
    expect((await req('/accounts', jwt, 'PUT', { email: second.email, enabled: true })).status).toBe(200);
    expect((await req('/customers', secondJwt)).status).toBe(200);
  });
  it('自行退出超过 30 天不能恢复，门店尚有成员时仍可重新获准加入', async () => {
    const second = { ...owner, email: 'second@example.com' };
    env.STAFF_ACCOUNTS = JSON.stringify([owner, second]);
    const jwt = await token(), secondJwt = await token({ email: second.email });
    await req('/me', jwt);
    await req('/accounts/stores/' + owner.tenantId + '/leave', secondJwt, 'POST');
    db.prepare("UPDATE store_memberships SET left_at='2000-01-01 00:00:00' WHERE email=?").run(second.email);
    expect((await req('/accounts/stores/' + owner.tenantId + '/rejoin', secondJwt, 'POST')).status).toBe(403);
    expect((await req('/customers', secondJwt)).status).toBe(403);
    expect((await req('/accounts', jwt, 'PUT', { email: second.email, enabled: true })).status).toBe(200);
    expect((await req('/customers', secondJwt)).status).toBe(200);
  });
  it('门店删除立即撤销同事已有 JWT 的访问，其他门店不能恢复该店', async () => {
    const jwt = await token();
    const created = await (await req('/accounts/stores', jwt, 'POST', { name: '新门店' })).json() as any;
    const switched = await req('/accounts/stores/' + created.id + '/switch', jwt, 'POST');
    const selected = switched.headers.get('Set-Cookie')!.split(';')[0];
    const colleague = { email: 'colleague@example.com', name: '同事', enabled: true };
    const provided = { ...owner, ...colleague, tenantId: created.id, storeName: '新门店' };
    env.STAFF_ACCOUNTS = JSON.stringify([owner, provided]);
    expect((await req('/accounts', jwt, 'PUT', colleague, { Cookie: selected })).status).toBe(200);
    const colleagueJwt = await token({ email: colleague.email });
    expect((await req('/me', colleagueJwt)).status).toBe(200);
    const deleted = await req('/accounts/stores/' + created.id, jwt, 'DELETE', { name: '新门店' }, { Cookie: selected });
    expect(deleted.status).toBe(200);
    expect((await req('/me', colleagueJwt)).status).toBe(200);
    expect((await (await req('/me', colleagueJwt)).json() as any).tenant_id).toBe('');
    expect((await req('/customers', colleagueJwt)).status).toBe(403);
    const outsider = { ...owner, email: 'other@example.com', tenantId: 'other-store', storeName: '另一门店' };
    env.STAFF_ACCOUNTS = JSON.stringify([owner, provided, outsider]);
    const outsiderJwt = await token({ email: outsider.email });
    expect(await (await req('/accounts/stores/removed', outsiderJwt)).json()).toEqual([]);
    expect((await req('/accounts/stores/' + created.id + '/restore', outsiderJwt, 'POST')).status).toBe(404);
    expect((await req('/accounts/stores/' + created.id + '/restore', jwt, 'POST')).status).toBe(200);
    expect((await req('/me', colleagueJwt)).status).toBe(200);
  });
  it('初始配置指向的门店删除后不会由 STAFF_ACCOUNTS 自动重建', async () => {
    const jwt = await token();
    await req('/accounts/presence', jwt, 'POST');
    await req('/accounts/stores', jwt, 'POST', { name: '保留门店' });
    expect((await req('/accounts/stores/' + owner.tenantId, jwt, 'DELETE', { name: owner.storeName })).status).toBe(200);
    expect((await (await req('/me', jwt)).json() as any).tenant_id).not.toBe(owner.tenantId);
    expect((await (await req('/accounts/stores', jwt)).json() as any[]).some((row) => row.id === owner.tenantId)).toBe(false);
  });
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
  it('只有后台授权邮箱可以加入，姓名头像仅本人可改，撤权立即生效', async () => {
    const jwt = await token();
    expect((await req('/accounts', jwt, 'PUT', { email: owner.email, name: '新名称', enabled: true })).status).toBe(200);
    expect((await (await req('/me', jwt)).json() as any).name).toBe('新名称');
    expect((await req('/accounts', jwt, 'PUT', { email: owner.email, name: '新名称', enabled: false })).status).toBe(400);
    const colleague = { email: 'second@example.com', name: '另一店主', enabled: true };
    const secondJwt = await token({ email: colleague.email });
    expect((await req('/accounts', jwt, 'PUT', colleague)).status).toBe(403);
    expect(db.prepare('SELECT * FROM accounts WHERE email=?').get(colleague.email)).toBeUndefined();
    // Even a legacy managed database profile and membership are insufficient.
    db.prepare("INSERT INTO accounts(email,tenant_id,name,store_name,enabled,source) VALUES(?,?,?,?,1,'managed')")
      .run(colleague.email, owner.tenantId, colleague.name, owner.storeName);
    db.prepare("INSERT INTO store_memberships(email,tenant_id,name,enabled,source) VALUES(?,?,?,1,'managed')")
      .run(colleague.email, owner.tenantId, colleague.name);
    expect((await req('/me', secondJwt)).status).toBe(403);
    env.STAFF_ACCOUNTS = JSON.stringify([owner, { ...owner, email: colleague.email, name: colleague.name }]);
    expect((await req('/accounts', jwt, 'PUT', { email: colleague.email, enabled: true })).status).toBe(200);
    expect((await req('/me', secondJwt)).status).toBe(200);
    expect((await req('/accounts', jwt, 'PUT', { ...colleague, name: '被他人更改' })).status).toBe(403);
    expect((await req('/accounts', jwt, 'PUT', { email: colleague.email, enabled: true, avatar: '' })).status).toBe(403);
    expect((await req('/accounts', jwt, 'PUT', { email: colleague.email, enabled: false })).status).toBe(200);
    const me = await (await req('/me', secondJwt)).json() as any;
    expect(me.tenant_id).toBe('');
    expect((await req('/customers', secondJwt)).status).toBe(403);
    expect((await req('/accounts/stores/' + owner.tenantId + '/rejoin', secondJwt, 'POST')).status).toBe(403);
    expect((await req('/accounts', jwt, 'PUT', { email: colleague.email, enabled: true })).status).toBe(200);
    env.STAFF_ACCOUNTS = JSON.stringify([owner]);
    expect((await req('/me', secondJwt)).status).toBe(403);
    expect((await req('/customers', secondJwt)).status).toBe(403);
    expect((await (await req('/accounts', jwt)).json() as any[]).some((row) => row.email === colleague.email)).toBe(false);
  });
  it('已有账户可加入多个门店，档案隔离，停用门店权限不影响其他门店', async () => {
    const jwt = await token();
    const other = { ...owner, email: 'other@example.com', tenantId: 'store-002', storeName: '另一门店' };
    env.STAFF_ACCOUNTS = JSON.stringify([owner, other]);
    const customer = await (await req('/customers', jwt, 'POST', profile)).json() as any;
    const otherJwt = await token({ email: other.email });
    expect((await req('/customers/' + customer.id + '/detail', otherJwt)).status).toBe(404);
    expect((await req('/accounts/stores/store-001/switch', otherJwt, 'POST')).status).toBe(403);
    expect((await req('/accounts', jwt, 'PUT', { email: other.email, enabled: true })).status).toBe(200);
    const switched = await req('/accounts/stores/store-001/switch', otherJwt, 'POST');
    expect(switched.status).toBe(200);
    const selected = switched.headers.get('Set-Cookie')!.split(';')[0];
    expect((await req('/customers/' + customer.id + '/detail', otherJwt, 'GET', undefined, { Cookie: selected })).status).toBe(200);
    expect((await req('/accounts', jwt, 'PUT', { email: other.email, enabled: false })).status).toBe(200);
    expect((await req('/customers/' + customer.id + '/detail', otherJwt, 'GET', undefined, { Cookie: selected })).status).toBe(403);
    expect((await (await req('/me', otherJwt, 'GET', undefined, { Cookie: selected })).json() as any).tenant_id).toBe('store-002');
    expect((await req('/accounts/stores/store-001/rejoin', otherJwt, 'POST')).status).toBe(403);
    expect((await req('/accounts', jwt, 'PUT', { email: 'unprovided@example.com', enabled: true })).status).toBe(403);
    expect((await req('/accounts')).status).toBe(401);
    expect((await req('/accounts', await token({ email: 'stranger@example.com' }), 'PUT', { email: other.email, enabled: true })).status).toBe(403);
  });
  it('停用仅影响成员关系，旧角色不会自动变为店主', async () => {
    const second = { ...owner, email: 'second@example.com' };
    env.STAFF_ACCOUNTS = JSON.stringify([owner, second, { ...owner, email: 'legacy@example.com', role: '前台' }]);
    const jwt = await token();
    expect((await req('/accounts', jwt, 'PUT', { email: second.email, enabled: false })).status).toBe(200);
    const secondJwt = await token({ email: second.email });
    expect((await (await req('/me', secondJwt)).json() as any).tenant_id).toBe('');
    expect((await req('/export', secondJwt)).status).toBe(403);
    expect((await req('/me', await token({ email: 'legacy@example.com' }))).status).toBe(403);
    expect((await (await req('/accounts', jwt)).json() as any[]).some((a) => a.email === 'legacy@example.com')).toBe(false);
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
