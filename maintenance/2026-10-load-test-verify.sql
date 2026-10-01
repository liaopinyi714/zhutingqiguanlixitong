-- Read-only before/after counts. Intentionally also find altered/manual children
-- so an incomplete cleanup is visible. No names, contacts or store IDs returned.
SELECT
  (SELECT COUNT(*) FROM customers WHERE id GLOB 'loadtest-20261001-*') AS customers_remaining,
  (SELECT COUNT(*) FROM fittings WHERE id GLOB 'loadtest-20261001-*' OR customer_id GLOB 'loadtest-20261001-*') AS fittings_remaining,
  (SELECT COUNT(*) FROM exams WHERE id GLOB 'loadtest-20261001-*' OR customer_id GLOB 'loadtest-20261001-*') AS exams_remaining,
  (SELECT COUNT(*) FROM followups WHERE id GLOB 'loadtest-20261001-*' OR customer_id GLOB 'loadtest-20261001-*') AS followups_remaining,
  (SELECT COUNT(*) FROM repairs WHERE id GLOB 'loadtest-20261001-*' OR customer_id GLOB 'loadtest-20261001-*') AS repairs_remaining,
  (SELECT COUNT(*) FROM audit WHERE customer_id GLOB 'loadtest-20261001-*') AS audit_remaining,
  (SELECT COUNT(*) FROM attachments WHERE customer_id GLOB 'loadtest-20261001-*') AS attachments_remaining;
