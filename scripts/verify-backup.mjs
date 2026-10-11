import { resolve } from 'node:path';
import { verifyBackup } from './backup-integrity.mjs';

try {
  const [directory, ...extra] = process.argv.slice(2);
  if (!directory || extra.length) throw new Error('用法：pnpm backup:verify <备份目录>');
  const result = await verifyBackup(resolve(directory));
  console.log(`备份校验通过：数据库 SQL 和 ${result.attachments} 个报告文件均与清单一致。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : '备份校验失败');
  process.exitCode = 1;
}
