import { readStaffAccounts, type AuthEnv } from './auth';

export const RETENTION_DAYS = 30;
const dayMs = 24 * 60 * 60 * 1000;

export function retentionCutoff(now = new Date()) {
  return new Date(now.getTime() - RETENTION_DAYS * dayMs)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export async function purgeExpiredRecords(
  env: AuthEnv & { DB: D1Database; FILES: R2Bucket },
  now = new Date(),
) {
  const cutoff = retentionCutoff(now);
  // Removing an identity from the operator's allowlist also stops it from
  // keeping a store alive. Missing/invalid production configuration must never
  // be interpreted as an empty allowlist and trigger data deletion.
  if (env.STAFF_ACCOUNTS) {
    const provided = readStaffAccounts(env.STAFF_ACCOUNTS).filter((a) => a.role === '店主');
    const validMembers = `SELECT 1 FROM store_memberships m,json_each(?) p
      WHERE m.tenant_id=stores.id AND m.enabled=1 AND m.email=json_extract(p.value,'$.email')`;
    await env.DB.prepare(
      `UPDATE stores SET abandoned_at=COALESCE(abandoned_at,?)
      WHERE deleted_at IS NULL AND NOT EXISTS(${validMembers})`,
    )
      .bind(now.toISOString().slice(0, 19).replace('T', ' '), JSON.stringify(provided))
      .run();
    await env.DB.prepare(
      `UPDATE stores SET abandoned_at=NULL
      WHERE deleted_at IS NULL AND abandoned_at>? AND EXISTS(${validMembers})`,
    )
      .bind(cutoff, JSON.stringify(provided))
      .run();
  }
  await env.DB.prepare(
    `UPDATE stores SET deleted_at=abandoned_at
    WHERE deleted_at IS NULL AND abandoned_at IS NOT NULL AND abandoned_at<=?`,
  )
    .bind(cutoff)
    .run();
  const expiredStore =
    'tenant_id IN (SELECT id FROM stores WHERE deleted_at IS NOT NULL AND deleted_at<=?)';
  let filesPurged = 0;
  // Batch R2 and D1 operations, and bound each run for the Workers free tier.
  for (let batch = 0; batch < 10; batch++) {
    const rows = await env.DB.prepare(
      `SELECT a.id,a.object_key FROM attachments a
      JOIN customers c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
      WHERE (a.deleted_at IS NOT NULL AND a.deleted_at<=?) OR (c.deleted_at IS NOT NULL AND c.deleted_at<=?)
        OR a.${expiredStore}
      LIMIT 50`,
    )
      .bind(cutoff, cutoff, cutoff)
      .all<{ id: string; object_key: string }>();
    if (!rows.results.length) break;
    await env.FILES.delete(rows.results.map((row) => row.object_key));
    await env.DB.prepare(
      `DELETE FROM attachments WHERE id IN (${rows.results.map(() => '?').join(',')})`,
    )
      .bind(...rows.results.map((row) => row.id))
      .run();
    filesPurged += rows.results.length;
  }
  const expiredParent =
    'customer_id IN (SELECT id FROM customers WHERE deleted_at IS NOT NULL AND deleted_at<=?)';
  await env.DB.prepare(
    `DELETE FROM repairs WHERE (deleted_at IS NOT NULL AND deleted_at<=?) OR ${expiredParent}
      OR fitting_id IN (SELECT id FROM fittings WHERE deleted_at IS NOT NULL AND deleted_at<=?)
      OR ${expiredStore}`,
  )
    .bind(cutoff, cutoff, cutoff, cutoff)
    .run();
  for (const table of ['exams', 'fittings', 'followups'] as const) {
    await env.DB.prepare(
      `DELETE FROM ${table} WHERE (deleted_at IS NOT NULL AND deleted_at<=?) OR ${expiredParent} OR ${expiredStore}`,
    )
      .bind(cutoff, cutoff, cutoff)
      .run();
  }
  await env.DB.prepare(
    'DELETE FROM audit WHERE customer_id IN (SELECT id FROM customers WHERE deleted_at IS NOT NULL AND deleted_at<=? AND NOT EXISTS (SELECT 1 FROM attachments WHERE attachments.customer_id=customers.id))',
  )
    .bind(cutoff)
    .run();
  await env.DB.prepare(
    `DELETE FROM customers WHERE ((deleted_at IS NOT NULL AND deleted_at<=?) OR ${expiredStore})
      AND NOT EXISTS (SELECT 1 FROM attachments WHERE attachments.customer_id=customers.id)`,
  )
    .bind(cutoff, cutoff)
    .run();
  await env.DB.prepare(
    `DELETE FROM audit WHERE ${expiredStore}
     AND NOT EXISTS (SELECT 1 FROM customers WHERE customers.tenant_id=audit.tenant_id)
     AND NOT EXISTS (SELECT 1 FROM attachments WHERE attachments.tenant_id=audit.tenant_id)`,
  )
    .bind(cutoff)
    .run();
  await env.DB.prepare(`DELETE FROM store_memberships WHERE ${expiredStore}`).bind(cutoff).run();
  // Historical catalog data is no longer editable, but must follow store
  // retention too. Delete children before parents to respect foreign keys.
  for (const table of ['device_models', 'device_series', 'device_brands'])
    await env.DB.prepare(`DELETE FROM ${table} WHERE ${expiredStore}`).bind(cutoff).run();
  // Independent account profiles survive store deletion. Keep the small
  // disabled membership tombstone to prevent initial configuration re-adding
  // people after their voluntary recovery period expires.
  await env.DB.prepare(
    "UPDATE store_memberships SET avatar='',name='',last_seen_at=NULL WHERE enabled=0 AND left_at<=?",
  )
    .bind(cutoff)
    .run();
  // Keep a tiny store tombstone so bootstrap configuration cannot recreate deleted stores.
  await env.DB.prepare(
    `UPDATE stores SET name='已删除门店' WHERE deleted_at IS NOT NULL AND deleted_at<=?`,
  )
    .bind(cutoff)
    .run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now.getTime()).run();
  return { filesPurged, cutoff };
}
