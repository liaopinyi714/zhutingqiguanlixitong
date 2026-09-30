import type { Session } from './auth';

export class WriteConflictError extends Error {
  constructor() {
    super('资料或门店权限已变化，请刷新后再操作');
  }
}

// Include these predicates in the mutation itself, not just an earlier read.
// Positional bindings: store ID, actor email; or customer ID, store ID, email.
export const activeStoreWrite = `EXISTS (
  SELECT 1 FROM stores s JOIN store_memberships m ON m.tenant_id=s.id
  WHERE s.id=? AND m.email=? AND m.enabled=1 AND s.deleted_at IS NULL
    AND (s.abandoned_at IS NULL OR s.abandoned_at>datetime('now','-30 days'))
)`;
export const activeCustomerWrite = `EXISTS (
  SELECT 1 FROM customers c JOIN stores s ON s.id=c.tenant_id
  JOIN store_memberships m ON m.tenant_id=s.id
  WHERE c.id=? AND c.tenant_id=? AND c.deleted_at IS NULL AND m.email=? AND m.enabled=1
    AND s.deleted_at IS NULL
    AND (s.abandoned_at IS NULL OR s.abandoned_at>datetime('now','-30 days'))
)`;
export const activeFittingWrite = `EXISTS (
  SELECT 1 FROM fittings f WHERE f.id=? AND f.customer_id=? AND f.tenant_id=? AND f.deleted_at IS NULL
)`;

// Keep this immediately after the mutation in the same D1 transaction.
// A stale request that changes no record must not produce a success audit row.
export function auditAfterWrite(
  db: D1Database,
  session: Session,
  action: string,
  customerId: string | null = null,
) {
  return db
    .prepare(
      'INSERT INTO audit(id,tenant_id,actor,action,customer_id) SELECT ?,?,?,?,? WHERE changes()>0',
    )
    .bind(crypto.randomUUID(), session.tenant_id, session.actor, action, customerId);
}

// Mutation statements must use RETURNING id. batch preserves the write/audit
// transaction; an empty returned result means a checked scope or state changed.
export async function commitWrite(
  db: D1Database,
  session: Session,
  statement: D1PreparedStatement,
  action: string,
  customerId: string | null = null,
) {
  const [written] = await db.batch([statement, auditAfterWrite(db, session, action, customerId)]);
  if (!written.results.length) throw new WriteConflictError();
}
