import { readFileSync } from 'node:fs';
export const retiredBuildVariables = ['LOAD_TEST_CUSTOMERS', 'LOAD_TEST_STORE_ID'];
export function readConfig() {
  // Keep this file valid JSON; the .jsonc name is the Wrangler convention.
  return JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\uFEFF/, ''));
}
// Resource order is not a contract. Configure, export and validate the same
// explicit bindings, and fail before writing if a binding is missing/ambiguous.
function uniqueBinding(config, collection, name) {
  const resources = config?.[collection];
  const matches = Array.isArray(resources)
    ? resources.filter((item) => item?.binding === name)
    : [];
  if (matches.length !== 1) throw new Error(`${collection} 必须包含且仅包含一个 ${name} 绑定`);
  return matches[0];
}
export function productionBindings(config) {
  return {
    db: uniqueBinding(config, 'd1_databases', 'DB'),
    files: uniqueBinding(config, 'r2_buckets', 'FILES'),
  };
}
export function configErrors(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    return ['正式配置必须是 JSON 对象'];
  const errors = [];
  for (const name of retiredBuildVariables)
    if (config.vars?.[name] !== undefined) errors.push(`移除已退役的压测变量 ${name}`);
  if (!/^[a-f0-9]{32}$/i.test(config.account_id || '')) errors.push('填写 Cloudflare Account ID');
  if (config.vars?.DEMO_MODE !== 'false') errors.push('正式环境 DEMO_MODE 必须为 false');
  if (!/^[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(config.vars?.ACCESS_TEAM_DOMAIN || ''))
    errors.push('填写 Access Team Domain（不带 https://）');
  if (!/^[a-f0-9]{64}$/i.test(config.vars?.ACCESS_AUD || ''))
    errors.push('填写 Access 应用的 64 位 AUD');
  const checkedBinding = (collection, name) => {
    try {
      return uniqueBinding(config, collection, name);
    } catch (error) {
      errors.push(error.message);
      return undefined;
    }
  };
  const db = checkedBinding('d1_databases', 'DB');
  const files = checkedBinding('r2_buckets', 'FILES');
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      db?.database_id || '',
    ) ||
    db?.database_id === '00000000-0000-0000-0000-000000000000'
  )
    errors.push('填写正式 D1 Database ID');
  if (db?.migrations_dir !== 'migrations-production')
    errors.push('正式环境必须使用 migrations-production');
  if (!db?.database_name || db.database_name === 'hearing-care')
    errors.push('使用独立的正式数据库');
  const bucket = files?.bucket_name;
  if (!bucket || bucket === 'hearing-care-private') errors.push('使用独立的正式 R2 存储桶');
  if (config.preview_urls !== false) errors.push('保持 preview_urls=false，避免未经配置的预览入口');
  return errors;
}
