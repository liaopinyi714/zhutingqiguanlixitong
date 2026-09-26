import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readStaffAccounts } from '../server/auth.ts';
import { configErrors, readConfig } from './production-config.mjs';
const errors = configErrors(readConfig());
if (errors.length) throw new Error(errors.join('\n'));
const staff = readStaffAccounts(
  JSON.stringify(
    JSON.parse(readFileSync('config/staff.local.json', 'utf8').replace(/^\uFEFF/, '')),
  ),
);
if (staff.some((row) => row.email.endsWith('@example.com')))
  throw new Error('请把示例邮箱改成真实员工邮箱');
for (const tenant of new Set(staff.map((row) => row.tenantId))) {
  if (!staff.some((row) => row.tenantId === tenant && row.role === '店主'))
    throw new Error('每个门店至少配置一位店主');
}
// Send the roster through stdin, never through command arguments or logs.
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/wrangler/bin/wrangler.js'),
    'secret',
    'put',
    'STAFF_ACCOUNTS',
    '--config',
    'wrangler.jsonc',
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
child.stdin.end(JSON.stringify(staff));
child.on('error', () => {
  console.error('无法启动 Wrangler');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
