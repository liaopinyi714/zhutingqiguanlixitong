import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createBackupManifest, verifyBackup } from '../scripts/backup-integrity.mjs';

let directory: string | undefined;
afterEach(() => {
  if (!directory) return;
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('hearing-backup-'))
    throw new Error('Unexpected temporary directory');
  rmSync(target, { recursive: true, force: true });
  directory = undefined;
});

const config = {
  d1_databases: [
    { binding: 'OTHER', database_id: 'other' },
    { binding: 'DB', database_id: 'backup-test-database' },
  ],
  r2_buckets: [
    { binding: 'OTHER', bucket_name: 'other' },
    { binding: 'FILES', bucket_name: 'backup-test-files' },
  ],
};
const objectKey = 'store/customer/report';
const content = 'synthetic report';

function fixture(key = objectKey, customer = 'customer') {
  directory = mkdtempSync(join(tmpdir(), 'hearing-backup-'));
  const root = join(directory, 'backup');
  mkdirSync(join(root, 'files/store/customer'), { recursive: true });
  writeFileSync(join(root, 'files', objectKey), content);
  writeFileSync(
    join(root, 'database.sql'),
    `
    PRAGMA foreign_keys = OFF;
    CREATE TABLE customers (id TEXT PRIMARY KEY);
    CREATE TABLE attachments (id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), object_key TEXT, size INTEGER);
    INSERT INTO customers VALUES ('customer');
    INSERT INTO attachments VALUES ('report', '${customer}', '${key}', ${Buffer.byteLength(content)});
  `,
  );
  return root;
}

async function complete(root: string) {
  const manifest = await createBackupManifest(root, config);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'COMPLETE'), 'complete');
  return manifest;
}

describe('本地完整备份与离线校验', () => {
  it('核对实际 DB/FILES 绑定、SQL 与附件；离线 CLI 不依赖 Cloudflare 配置', async () => {
    const root = fixture();
    const manifest = await complete(root);
    expect(manifest.database).toBe('backup-test-database');
    expect(manifest.bucket).toBe('backup-test-files');
    expect(manifest.attachments).toEqual([
      {
        id: 'report',
        objectKey,
        size: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
      },
    ]);
    expect(await verifyBackup(root)).toEqual({ attachments: 1 });
    const original = readFileSync(join(root, 'manifest.json'), 'utf8');
    const result = spawnSync(process.execPath, [resolve('scripts/verify-backup.mjs'), root], {
      cwd: directory,
      windowsHide: true,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 个报告文件');
    expect(readFileSync(join(root, 'manifest.json'), 'utf8')).toBe(original);
    expect(existsSync(join(root, 'wrangler.jsonc'))).toBe(false);
  });

  it.each(['invalid SQL', 'orphan foreign key'])('拒绝无法完整还原的导出：%s', async (failure) => {
    const root = fixture(objectKey, failure === 'orphan foreign key' ? 'missing' : 'customer');
    if (failure === 'invalid SQL') writeFileSync(join(root, 'database.sql'), 'not valid SQL');
    await expect(complete(root)).rejects.toThrow('备份 SQL 无法完整还原');
    expect(existsSync(join(root, 'COMPLETE'))).toBe(false);
  });

  it.each(['missing file', 'size mismatch'])(
    '缺失或截断的报告不能标记为完成：%s',
    async (failure) => {
      const root = fixture();
      const path = join(root, 'files', objectKey);
      if (failure === 'missing file') rmSync(path);
      else writeFileSync(path, 'short');
      await expect(complete(root)).rejects.toThrow();
      expect(existsSync(join(root, 'COMPLETE'))).toBe(false);
    },
  );

  it('同样大小的报告损坏及 SQL 损坏均可离线识别', async () => {
    const root = fixture();
    await complete(root);
    writeFileSync(join(root, 'files', objectKey), 'x'.repeat(Buffer.byteLength(content)));
    await expect(verifyBackup(root)).rejects.toThrow('报告文件校验失败');
    writeFileSync(join(root, 'files', objectKey), content);
    writeFileSync(join(root, 'database.sql'), 'changed');
    await expect(verifyBackup(root)).rejects.toThrow('数据库 SQL 校验失败');
    const result = spawnSync(process.execPath, [resolve('scripts/verify-backup.mjs'), root], {
      cwd: directory,
      windowsHide: true,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('数据库 SQL 校验失败');
  });

  it('未完成的备份不能通过校验', async () => {
    const root = fixture();
    await complete(root);
    rmSync(join(root, 'COMPLETE'));
    await expect(verifyBackup(root)).rejects.toThrow('备份文件缺失');
  });

  it('重复的附件清单不能通过校验', async () => {
    const root = fixture();
    const manifest = await complete(root);
    manifest.attachments.push({ ...manifest.attachments[0] });
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    await expect(verifyBackup(root)).rejects.toThrow('附件校验清单格式错误或重复');
  });

  it.each(['../report', 'C:/report', 'store\\report'])(
    '拒绝清单中的目录逃逸路径：%s',
    async (key) => {
      const root = fixture();
      const manifest = await complete(root);
      manifest.attachments[0].objectKey = key;
      writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
      await expect(verifyBackup(root)).rejects.toThrow('备份文件路径不合法');
    },
  );

  it('拒绝通过 junction/symlink 读取备份目录外的报告', async () => {
    const root = fixture('escape/report');
    const outside = join(directory!, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'report'), content);
    const link = join(root, 'files/escape');
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await expect(complete(root)).rejects.toThrow('备份文件缺失或路径超出备份目录');
    } finally {
      // Remove only the link before cleaning the verified temporary directory.
      rmSync(link);
    }
    expect(readFileSync(join(outside, 'report'), 'utf8')).toBe(content);
  });

  it('离线复核只比对哈希，不执行已有备份中的 SQL', async () => {
    const root = fixture();
    const manifest = await complete(root);
    const sql = 'This deliberately is not executable SQL.';
    writeFileSync(join(root, 'database.sql'), sql);
    manifest.sqlSha256 = createHash('sha256').update(sql).digest('hex');
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    // A manifest is an integrity reference, not a signature or restore drill.
    expect(await verifyBackup(root)).toEqual({ attachments: 1 });
  });
});
