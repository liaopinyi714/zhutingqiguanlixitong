ALTER TABLE customers ADD COLUMN deleted_at TEXT;
ALTER TABLE followups ADD COLUMN deleted_at TEXT;
CREATE INDEX customers_active_tenant ON customers(tenant_id,deleted_at,created_at);
CREATE INDEX followups_active_tenant ON followups(tenant_id,deleted_at,due);
