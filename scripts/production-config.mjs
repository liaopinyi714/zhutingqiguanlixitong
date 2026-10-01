import { readFileSync } from 'node:fs';
export const retiredBuildVariables = ['LOAD_TEST_CUSTOMERS', 'LOAD_TEST_STORE_ID'];
export function readConfig() {
  // Keep this file valid JSON; the .jsonc name is the Wrangler convention.
  return JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\uFEFF/, ''));
}
export function configErrors(config) {
  const errors = [];
  for (const name of retiredBuildVariables)
    if (config.vars?.[name] !== undefined) errors.push(`移除已退役的压测变量 ${name}`);
  if (!/^[a-f0-9]{32}$/i.test(config.account_id || '')) errors.push('填写 Cloudflare Account ID');
  if (config.vars?.DEMO_MODE !== 'false') errors.push('正式环境 DEMO_MODE 必须为 false');
  if (!/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(config.vars?.ACCESS_TEAM_DOMAIN || ''))
    errors.push('填写 Access Team Domain（不带 https://）');
  if (!/^[a-f0-9]{64}$/i.test(config.vars?.ACCESS_AUD || ''))
    errors.push('填写 Access 应用的 64 位 AUD');
  const db = config.d1_databases?.find((item) => item.binding === 'DB');
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      db?.database_id || '',
    ) ||
    db.database_id === '00000000-0000-0000-0000-000000000000'
  )
    errors.push('填写正式 D1 Database ID');
  if (db?.migrations_dir !== 'migrations-production')
    errors.push('正式环境必须使用 migrations-production');
  if (!db?.database_name || db.database_name === 'hearing-care')
    errors.push('使用独立的正式数据库');
  const bucket = config.r2_buckets?.find((item) => item.binding === 'FILES')?.bucket_name;
  if (!bucket || bucket === 'hearing-care-private') errors.push('使用独立的正式 R2 存储桶');
  if (config.preview_urls !== false) errors.push('保持 preview_urls=false，避免未经配置的预览入口');
  return errors;
}
