import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { configErrors, retiredBuildVariables } from '../scripts/production-config.mjs';

let directory: string | undefined;
afterEach(() => {
  if (!directory) return;
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('hearing-release-'))
    throw new Error('Unexpected temporary directory');
  rmSync(target, { recursive: true, force: true });
  directory = undefined;
});

describe('正式构建退役压测入口', () => {
  it('遗留变量不再触发导入且不发布为绑定；配置检查继续拒绝错误生产资源', () => {
    directory = mkdtempSync(join(tmpdir(), 'hearing-release-'));
    const template = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    for (const name of retiredBuildVariables) template.vars[name] = 'private-retired-value';
    writeFileSync(join(directory, 'wrangler.jsonc'), JSON.stringify(template));
    const result = spawnSync(process.execPath, [resolve('scripts/configure-ci.mjs')], {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        WORKERS_CI: '1',
        WORKERS_CI_BRANCH: 'main',
        CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
        D1_DATABASE_ID: '11111111-1111-1111-1111-111111111111',
        ACCESS_TEAM_DOMAIN: 'release-test.cloudflareaccess.com',
        ACCESS_AUD: 'b'.repeat(64),
        LOAD_TEST_CUSTOMERS: '10000',
        LOAD_TEST_STORE_ID: 'private-retired-value',
      },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('private-retired-value');
    const config = JSON.parse(readFileSync(join(directory, 'wrangler.jsonc'), 'utf8'));
    expect(configErrors(config)).toEqual([]);
    // Execute the actual production checker against this generated temporary
    // configuration; never overwrite the repository's placeholders or use live IDs.
    const checked = spawnSync(process.execPath, [resolve('scripts/check-production.mjs')], {
      cwd: directory,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain('正式环境配置格式检查通过');
    for (const name of retiredBuildVariables) {
      expect(config.vars[name]).toBeUndefined();
      expect(configErrors({ ...config, vars: { ...config.vars, [name]: '10000' } })).toContain(
        `移除已退役的压测变量 ${name}`,
      );
    }
    expect(configErrors({ ...config, vars: { ...config.vars, DEMO_MODE: 'true' } })).toContain(
      '正式环境 DEMO_MODE 必须为 false',
    );
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.scripts['build:cloudflare']).toBe(
      'node scripts/configure-ci.mjs && pnpm check && wrangler d1 migrations apply DB --config wrangler.jsonc --remote',
    );
    expect(Object.keys(manifest.scripts).filter((name) => name.startsWith('seed:'))).toEqual([]);
    for (const path of ['scripts/load-test-data.mjs', 'scripts/seed-load-test.mjs'])
      expect(existsSync(path)).toBe(false);
  });
});
