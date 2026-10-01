-- One-time operator action, never part of build, deployment, Cron or migrations.
-- Run statements in order. Retry is safe. No account/store/schema changes.
-- Exact retired batch + UTF-8 store ID encoding + six-digit allowed number.
-- Preserve non-fixture relations and any customer still owning report files.

-- 1. Generated repairs; only their original generated customer/device relation.
DELETE FROM repairs
WHERE id GLOB 'loadtest-20261001-*'
  AND customer_id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-c-' || substr(customer_id,-6)
  AND substr(customer_id,-6) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
  AND CAST(substr(customer_id,-6) AS INTEGER) BETWEEN 1 AND 50000
  AND CAST(substr(customer_id,-6) AS INTEGER) % 200 = 0
  AND id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-r-' || substr(customer_id,-6)
  AND fitting_id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-f-' || substr(customer_id,-6) || '-1';

-- 2. Generated hearing records.
DELETE FROM exams
WHERE id GLOB 'loadtest-20261001-*'
  AND customer_id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-c-' || substr(customer_id,-6)
  AND substr(customer_id,-6) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
  AND CAST(substr(customer_id,-6) AS INTEGER) BETWEEN 1 AND 50000
  AND CAST(substr(customer_id,-6) AS INTEGER) % 100 = 0
  AND id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-e-' || substr(customer_id,-6);

-- 3. Generated follow-ups.
DELETE FROM followups
WHERE id GLOB 'loadtest-20261001-*'
  AND customer_id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-c-' || substr(customer_id,-6)
  AND substr(customer_id,-6) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
  AND CAST(substr(customer_id,-6) AS INTEGER) BETWEEN 1 AND 50000
  AND CAST(substr(customer_id,-6) AS INTEGER) % 40 = 0
  AND id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-u-' || substr(customer_id,-6);

-- 4. Generated fittings; do not orphan any additional repair.
DELETE FROM fittings
WHERE id GLOB 'loadtest-20261001-*'
  AND customer_id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-c-' || substr(customer_id,-6)
  AND substr(customer_id,-6) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
  AND CAST(substr(customer_id,-6) AS INTEGER) BETWEEN 1 AND 50000
  AND CAST(substr(customer_id,-6) AS INTEGER) % 20 = 0
  AND (
    id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-f-' || substr(customer_id,-6) || '-1'
    OR (CAST(substr(customer_id,-6) AS INTEGER) % 200 = 0
      AND id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-f-' || substr(customer_id,-6) || '-2')
  )
  AND NOT EXISTS (SELECT 1 FROM repairs r WHERE r.fitting_id=fittings.id);

-- 5. Test-customer audit only when that customer is safe to remove next or
-- already gone. Protect any conflicting live parent from another store.
DELETE FROM audit
WHERE customer_id GLOB 'loadtest-20261001-*'
  AND customer_id='loadtest-20261001-' || lower(hex(tenant_id)) || '-c-' || substr(customer_id,-6)
  AND substr(customer_id,-6) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
  AND CAST(substr(customer_id,-6) AS INTEGER) BETWEEN 1 AND 50000
  AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id=audit.customer_id AND c.tenant_id<>audit.tenant_id)
  AND customer_id NOT IN (SELECT customer_id FROM exams)
  AND customer_id NOT IN (SELECT customer_id FROM fittings)
  AND customer_id NOT IN (SELECT customer_id FROM followups)
  AND customer_id NOT IN (SELECT customer_id FROM repairs)
  AND customer_id NOT IN (SELECT customer_id FROM attachments);

-- 6. Generated customers, including soft-deleted ones; preserve extra records/files.
DELETE FROM customers
WHERE id GLOB 'loadtest-20261001-*'
  AND id = 'loadtest-20261001-' || lower(hex(tenant_id)) || '-c-' || substr(id,-6)
  AND substr(id,-6) GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
  AND CAST(substr(id,-6) AS INTEGER) BETWEEN 1 AND 50000
  -- All customer_id columns below are NOT NULL. Each blocking set is read once,
  -- instead of a full unscoped child scan for each of the 10000 customers.
  AND id NOT IN (SELECT customer_id FROM exams)
  AND id NOT IN (SELECT customer_id FROM fittings)
  AND id NOT IN (SELECT customer_id FROM followups)
  AND id NOT IN (SELECT customer_id FROM repairs)
  AND id NOT IN (SELECT customer_id FROM attachments);
