import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readConfig, configErrors, productionBindings } from './production-config.mjs';
import { createBackupManifest } from './backup-integrity.mjs';
const config = readConfig();
const errors = configErrors(config);
if (errors.length) throw new Error(errors.join('\n'));
const remote = process.env.RCLONE_REMOTE || 'hearing-r2';
if (!/^[a-zA-Z0-9_-]+$/.test(remote)) throw new Error('RCLONE_REMOTE 必须是 rclone 的远程配置名称');
const root = resolve('backups', new Date().toISOString().replace(/[:.]/g, '-'));
const { files } = productionBindings(config);
const bucket = files.bucket_name;
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0)
    throw new Error('备份步骤失败；本次目录未标记完成，请排查后重新备份');
}
console.log(
  '备份前请暂停员工写入；避开每日 02:00 的附件清理时段。备份包含客户敏感资料，应保存于加密磁盘。',
);
mkdirSync(root, { recursive: true });
mkdirSync(join(root, 'files'), { recursive: true });
run(process.execPath, [
  resolve('node_modules/wrangler/bin/wrangler.js'),
  'd1',
  'export',
  'DB',
  '--remote',
  '--config',
  'wrangler.jsonc',
  '--output',
  join(root, 'database.sql'),
]);
run('rclone', [
  'copy',
  `${remote}:${bucket}`,
  join(root, 'files'),
  '--transfers',
  '2',
  '--checkers',
  '2',
]);
const manifest = await createBackupManifest(root, config);
writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(root, 'COMPLETE'), 'Database export and attachment verification succeeded.\n');
console.log(`备份完成，共核对 ${manifest.attachments.length} 个附件：${root}`);
