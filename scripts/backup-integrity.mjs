import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { productionBindings } from './production-config.mjs';

function inside(root, path) {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

// Check both the written key and the resolved filesystem path. A moved backup
// must not use a junction/symlink or Windows drive/stream syntax to read outside it.
function backupFile(root, key) {
  if (
    typeof key !== 'string' ||
    key.includes('\\') ||
    key.includes(':') ||
    key.includes('\0') ||
    key.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('备份文件路径不合法');
  try {
    const base = realpathSync(root);
    const path = realpathSync(resolve(base, key));
    if (!inside(base, path) || !statSync(path).isFile()) throw new Error();
    return path;
  } catch {
    throw new Error('备份文件缺失或路径超出备份目录');
  }
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function attachmentHash(root, objectKey, size) {
  const path = backupFile(join(root, 'files'), objectKey);
  // Also require files/ itself to be inside the selected backup directory.
  if (!inside(realpathSync(root), path)) throw new Error('备份文件路径不合法');
  if (!Number.isSafeInteger(size) || size < 0 || statSync(path).size !== size)
    throw new Error('报告文件大小不匹配');
  return sha256(path);
}

// Only the freshly exported SQL is executed, in an in-memory validation DB.
// Rechecking an existing backup below never executes its SQL.
export async function createBackupManifest(root, config) {
  const { db: database, files } = productionBindings(config);
  const sql = readFileSync(backupFile(root, 'database.sql'));
  const db = new DatabaseSync(':memory:');
  const attachments = [];
  const keys = new Set();
  try {
    try {
      db.exec(sql.toString('utf8'));
      if (
        db.prepare('PRAGMA quick_check(1)').get()?.quick_check !== 'ok' ||
        db.prepare('PRAGMA foreign_key_check').get()
      )
        throw new Error();
    } catch {
      throw new Error('备份 SQL 无法完整还原或存在无效外键，备份未完成');
    }
    for (const row of db
      .prepare('SELECT id,object_key,size FROM attachments ORDER BY id')
      .iterate()) {
      if (keys.has(row.object_key)) throw new Error('备份存在重复的附件对象路径');
      keys.add(row.object_key);
      attachments.push({
        id: row.id,
        objectKey: row.object_key,
        size: row.size,
        sha256: await attachmentHash(root, row.object_key, row.size),
      });
    }
  } finally {
    db.close();
  }
  return {
    format: 1,
    createdAt: new Date().toISOString(),
    database: database.database_id,
    bucket: files.bucket_name,
    sqlSha256: createHash('sha256').update(sql).digest('hex'),
    attachments,
  };
}

export async function verifyBackup(root) {
  backupFile(root, 'COMPLETE');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(backupFile(root, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error('备份校验清单缺失或格式错误');
  }
  const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (
    manifest?.format !== 1 ||
    typeof manifest.database !== 'string' ||
    typeof manifest.bucket !== 'string' ||
    !validHash(manifest.sqlSha256) ||
    !Array.isArray(manifest.attachments)
  )
    throw new Error('备份校验清单格式不支持');
  if ((await sha256(backupFile(root, 'database.sql'))) !== manifest.sqlSha256)
    throw new Error('数据库 SQL 校验失败，文件可能已损坏或被修改');
  const ids = new Set(),
    keys = new Set();
  for (const row of manifest.attachments) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      ids.has(row.id) ||
      keys.has(row.objectKey) ||
      !validHash(row.sha256)
    )
      throw new Error('附件校验清单格式错误或重复');
    ids.add(row.id);
    keys.add(row.objectKey);
    if ((await attachmentHash(root, row.objectKey, row.size)) !== row.sha256)
      throw new Error('报告文件校验失败，文件可能已损坏或被修改');
  }
  return { attachments: manifest.attachments.length };
}
