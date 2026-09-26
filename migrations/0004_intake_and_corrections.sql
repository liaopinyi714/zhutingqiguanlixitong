ALTER TABLE customers ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE exams ADD COLUMN deleted_at TEXT;
ALTER TABLE fittings ADD COLUMN deleted_at TEXT;
CREATE INDEX fittings_active_tenant ON fittings(tenant_id,deleted_at,date);
-- Keep the fictional Demo useful for reviewing the reminder screen.
UPDATE fittings SET data=json_set(data,'$.warranty','2026-10-15') WHERE id='demo-1-fit' AND tenant_id='demo-store';
UPDATE fittings SET data=json_set(data,'$.warranty','2026-09-18') WHERE id='demo-3-fit' AND tenant_id='demo-store';
