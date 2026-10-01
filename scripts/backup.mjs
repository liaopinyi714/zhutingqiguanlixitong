import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readConfig, configErrors, productionBindings } from './production-config.mjs';
const config = readConfig();
const errors = configErrors(config);
if (errors.length) throw new Error(errors.join('\n'));
const remote = process.env.RCLONE_REMOTE || 'hearing-r2';
if (!/^[a-zA-Z0-9_-]+$/.test(remote)) throw new Error('RCLONE_REMOTE 必须是 rclone 的远程配置名称');
const root = resolve('backups', new Date().toISOString().replace(/[:.]/g, '-'));
const { db: database, files } = productionBindings(config);
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
const sql = readFileSync(join(root, 'database.sql'));
const db = new DatabaseSync(':memory:');
const manifest = [];
try {
  db.exec(sql.toString('utf8'));
  for (const row of db
    .prepare('SELECT id,object_key,size FROM attachments ORDER BY id')
    .iterate()) {
    const file = resolve(root, 'files', row.object_key);
    const rel = relative(resolve(root, 'files'), file);
    if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('备份对象路径不合法');
    if (statSync(file).size !== row.size) throw new Error('报告文件缺失或大小不匹配，备份未完成');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    manifest.push({
      id: row.id,
      objectKey: row.object_key,
      size: row.size,
      sha256: hash.digest('hex'),
    });
  }
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify(
      {
        format: 1,
        createdAt: new Date().toISOString(),
        database: database.database_id,
        bucket,
        sqlSha256: createHash('sha256').update(sql).digest('hex'),
        attachments: manifest,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, 'COMPLETE'), 'Database export and attachment verification succeeded.\n');
  console.log(`备份完成，共核对 ${manifest.length} 个附件：${root}`);
} finally {
  db.close();
}
