import { createInterface } from 'node:readline/promises';
import { writeFileSync } from 'node:fs';
import { readConfig, configErrors } from './production-config.mjs';
const config = readConfig();
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  console.log('请先按 docs/DEPLOYMENT.md 创建资源和 Access 应用。以下内容均不是密码。');
  const ask = async (label, current) =>
    (await input.question(`${label} [${current || '未填写'}]: `)).trim() || current;
  config.account_id = await ask('Cloudflare Account ID', config.account_id);
  config.name = await ask('Worker 名称', config.name);
  config.d1_databases[0].database_name = await ask('D1 名称', config.d1_databases[0].database_name);
  config.d1_databases[0].database_id = await ask(
    'D1 Database ID',
    config.d1_databases[0].database_id,
  );
  config.r2_buckets[0].bucket_name = await ask('私有 R2 桶名称', config.r2_buckets[0].bucket_name);
  config.vars.ACCESS_TEAM_DOMAIN = await ask(
    'Access Team Domain（不带 https://）',
    config.vars.ACCESS_TEAM_DOMAIN,
  );
  config.vars.ACCESS_AUD = await ask('Access 应用 AUD', config.vars.ACCESS_AUD);
  const errors = configErrors(config);
  if (errors.length) throw new Error(errors.join('\n'));
  writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
  console.log('wrangler.jsonc 已更新。下一步运行 pnpm db:production，再上传员工配置并部署。');
} finally {
  input.close();
}
