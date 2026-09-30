export const RETENTION_DAYS = 30;
const dayMs = 24 * 60 * 60 * 1000;

export function retentionCutoff(now = new Date()) {
  return new Date(now.getTime() - RETENTION_DAYS * dayMs)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

export async function purgeExpiredRecords(
  env: { DB: D1Database; FILES: R2Bucket },
  now = new Date(),
) {
  const cutoff = retentionCutoff(now);
  const expiredStore = 'tenant_id IN (SELECT id FROM stores WHERE deleted_at IS NOT NULL AND deleted_at<=?)';
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
  ).bind(cutoff).run();
  await env.DB.prepare(`DELETE FROM store_memberships WHERE ${expiredStore}`)
    .bind(cutoff).run();
  await env.DB.prepare(
    `DELETE FROM accounts WHERE source='managed' AND ${expiredStore}
     AND NOT EXISTS (SELECT 1 FROM store_memberships WHERE store_memberships.email=accounts.email)`,
  ).bind(cutoff).run();
  // Keep a tiny store tombstone so bootstrap configuration cannot recreate deleted stores.
  await env.DB.prepare(`UPDATE stores SET name='已删除门店' WHERE deleted_at IS NOT NULL AND deleted_at<=?`)
    .bind(cutoff).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now.getTime()).run();
  return { filesPurged, cutoff };
}
