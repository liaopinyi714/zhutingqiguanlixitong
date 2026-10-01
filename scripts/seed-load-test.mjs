import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readConfig, configErrors } from './production-config.mjs';
import {
  seedOptions,
  seedTables,
  seedSQL,
  seedCounts,
  seedCountSQL,
  estimatedSeedWrites,
} from './load-test-data.mjs';

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export function targetStoreSQL(storeId) {
  return `SELECT s.id FROM stores s WHERE s.deleted_at IS NULL AND s.abandoned_at IS NULL
    AND EXISTS (SELECT 1 FROM store_memberships m WHERE m.tenant_id=s.id AND m.enabled=1)
    ${storeId ? `AND s.id=${quote(storeId)}` : ''} ORDER BY s.id LIMIT 2;`;
}

export function requestedCount(env) {
  const setting = env.LOAD_TEST_CUSTOMERS;
  if (setting === undefined || setting === '' || setting === '0') return 0;
  if (!/^\d+$/.test(setting) || Number(setting) < 100 || Number(setting) > 50000)
    throw new Error('LOAD_TEST_CUSTOMERS 必须是 100 至 50000 的整数；当前建议 10000');
  return Number(setting);
}

function matchingCounts(actual, expected) {
  return seedTables.every((table) => Number(actual?.[table]) === expected[table]);
}

export async function seedLoadTest({
  env,
  config,
  execute,
  log = console.log,
  date = '2026-10-01',
}) {
  const count = requestedCount(env);
  if (!count) {
    log('压测数据开关未开启，跳过导入。');
    return { status: 'disabled' };
  }
  if (env.WORKERS_CI === '1' && env.WORKERS_CI_BRANCH !== 'main')
    throw new Error('压测数据只允许在 main 的正式构建中导入');
  const errors = configErrors(config);
  if (errors.length) throw new Error('正式配置未完成，拒绝导入压测数据');
  if (
    env.LOAD_TEST_STORE_ID !== undefined &&
    (!env.LOAD_TEST_STORE_ID.trim() ||
      env.LOAD_TEST_STORE_ID.length > 200 ||
      /[\x00-\x1f]/.test(env.LOAD_TEST_STORE_ID))
  )
    throw new Error('LOAD_TEST_STORE_ID 无效');
  const stores = await execute(targetStoreSQL(env.LOAD_TEST_STORE_ID));
  if (!stores.length) {
    if (env.LOAD_TEST_STORE_ID) throw new Error('指定门店不存在、已删除或没有启用成员，拒绝导入');
    log('尚无可导入门店；本次跳过压测数据并继续部署。登录网站建立门店后，再重试 main 构建。');
    return { status: 'deferred' };
  }
  if (stores.length !== 1)
    throw new Error('存在多个门店，未写入数据。请在构建变量 LOAD_TEST_STORE_ID 指定测试门店 ID');
  const o = seedOptions({ storeId: stores[0].id, count, date });
  log(
    `目标：${count} 名虚构客户，含设备、维修、随访和听力资料；按现有索引预计写入约 ${estimatedSeedWrites(seedCounts(1, count))} 行。`,
  );
  log(
    '导入使用 D1 免费写入额度；额度用尽后，须等北京时间次日 08:00 后重试构建。导入期间请暂停压力测试。',
  );
  let importedChunks = 0;
  for (let start = 1; start <= count; start += 1000) {
    const end = Math.min(count, start + 999),
      expected = seedCounts(start, end);
    const [before] = await execute(seedCountSQL(o, start, end));
    if (!matchingCounts(before, expected)) {
      // Wrangler's file importer runs a batch atomically. A failed chunk can be
      // retried; successful earlier chunks keep their deterministic IDs.
      await execute(seedSQL(o, start, end).join('\n'), true);
      const [after] = await execute(seedCountSQL(o, start, end));
      if (!matchingCounts(after, expected))
        throw new Error(
          '压测批次未完整写入。请检查门店状态或测试记录是否已被物理清理；未修改账户或门店权限',
        );
      importedChunks++;
    }
    log(`已确认 ${end}/${count} 名测试客户及本批关联资料。`);
  }
  const [totals] = await execute(seedCountSQL(o));
  if (!matchingCounts(totals, seedCounts(1, count))) throw new Error('压测数据总数核验失败');
  log(
    `压测数据核验完成：客户 ${totals.customers}、验配 ${totals.fittings}、听力 ${totals.exams}、随访 ${totals.followups}、维修 ${totals.repairs}。请删除 LOAD_TEST_CUSTOMERS 构建变量。`,
  );
  return { status: 'complete', totals, importedChunks };
}

export function wranglerExecutor(configPath, run = spawnSync) {
  return async (sql, file = false) => {
    let directory;
    try {
      const args = [
        'node_modules/wrangler/bin/wrangler.js',
        'd1',
        'execute',
        'DB',
        '--config',
        configPath,
        '--remote',
        '--json',
        '--yes',
      ];
      if (file) {
        directory = mkdtempSync(join(tmpdir(), 'hearing-loadtest-'));
        const path = join(directory, 'chunk.sql');
        writeFileSync(path, sql);
        args.push('--file', path);
      } else args.push('--command', sql);
      const result = run(process.execPath, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      });
      if (result.error || result.status !== 0) {
        const output = `${result.stdout || ''}\n${result.stderr || ''}`;
        if (/exceeded D1.*daily.*limit|daily row (read|write) limit/i.test(output))
          throw new Error(
            'D1 当天免费额度已用尽。已完成批次不会重复；北京时间次日 08:00 后重试 main 构建',
          );
        throw new Error(
          'D1 压测导入失败，请检查构建令牌 D1 Edit 权限、数据库连接或 Cloudflare D1 控制台。可安全重试；未输出令牌或账户资料',
        );
      }
      // File import's spinner writes progress text directly to stdout even with
      // --json. Its exit status is checked above; seedLoadTest then verifies all
      // five table counts through a separate structured SELECT. Never parse or
      // print the import transcript, nor infer success from its progress text.
      if (file) return [];
      let response;
      try {
        response = JSON.parse(result.stdout);
      } catch {
        throw new Error('D1 返回格式异常，未继续导入');
      }
      if (!Array.isArray(response) || response.some((entry) => entry.success !== true))
        throw new Error('D1 未确认本批成功，未继续导入');
      return response.flatMap((entry) => entry.results || []);
    } finally {
      // This exact temporary directory is created above, never taken from input.
      if (directory) {
        const absolute = resolve(directory);
        if (
          dirname(absolute) !== resolve(tmpdir()) ||
          !basename(absolute).startsWith('hearing-loadtest-')
        )
          throw new Error('临时文件目录校验失败，未执行清理');
        rmSync(absolute, { recursive: true, force: true });
      }
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    // Disabled builds perform no reads, no file generation and no network calls.
    if (!requestedCount(process.env)) console.log('压测数据开关未开启，跳过导入。');
    else
      await seedLoadTest({
        env: process.env,
        config: readConfig(),
        execute: wranglerExecutor('wrangler.jsonc'),
      });
  } catch (error) {
    console.error(error instanceof Error ? error.message : '压测导入失败');
    process.exitCode = 1;
  }
}
