import { writeFileSync } from 'node:fs';
import { readConfig, configErrors } from './production-config.mjs';
if (process.env.WORKERS_CI === '1' && process.env.WORKERS_CI_BRANCH !== 'main')
  throw new Error('正式数据库迁移仅允许在 Cloudflare Builds 的 main 分支运行');
const config = readConfig();
config.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
config.name = process.env.WORKER_NAME || 'hearing-care';
config.vars.ACCESS_TEAM_DOMAIN = process.env.ACCESS_TEAM_DOMAIN;
config.vars.ACCESS_AUD = process.env.ACCESS_AUD;
config.d1_databases[0].database_id = process.env.D1_DATABASE_ID;
config.d1_databases[0].database_name = process.env.D1_DATABASE_NAME || 'hearing-care-production';
config.r2_buckets[0].bucket_name = process.env.R2_BUCKET_NAME || 'hearing-care-production-private';
const errors = configErrors(config);
if (errors.length) throw new Error(errors.join('\n'));
writeFileSync('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
