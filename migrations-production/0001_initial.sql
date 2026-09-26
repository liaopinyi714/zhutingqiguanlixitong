PRAGMA foreign_keys = ON;
CREATE TABLE customers (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, gender TEXT NOT NULL, birth_date TEXT NOT NULL, phone TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, status TEXT NOT NULL, history TEXT NOT NULL DEFAULT '', needs TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX customers_tenant ON customers(tenant_id, name);
CREATE TABLE exams (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id), date TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX exams_customer ON exams(tenant_id,customer_id,date);
CREATE TABLE fittings (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id), date TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE followups (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id), due TEXT NOT NULL, type TEXT NOT NULL, note TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, result TEXT NOT NULL DEFAULT '', completed_at TEXT);
CREATE INDEX followups_due ON followups(tenant_id,completed,due);
CREATE TABLE attachments (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL REFERENCES customers(id), name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, object_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE audit (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, customer_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, tenant_id TEXT NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE device_brands (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX device_brands_active_name ON device_brands(tenant_id,name) WHERE active=1;
CREATE TABLE device_series (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL REFERENCES device_brands(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX device_series_active_name ON device_series(tenant_id,brand_id,name) WHERE active=1;
CREATE INDEX device_series_brand ON device_series(tenant_id,brand_id,active);
CREATE TABLE device_models (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, series_id TEXT NOT NULL REFERENCES device_series(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX device_models_active_name ON device_models(tenant_id,series_id,name) WHERE active=1;
CREATE INDEX device_models_series ON device_models(tenant_id,series_id,active);


ALTER TABLE customers ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE exams ADD COLUMN deleted_at TEXT;
ALTER TABLE fittings ADD COLUMN deleted_at TEXT;
CREATE INDEX fittings_active_tenant ON fittings(tenant_id,deleted_at,date);
ALTER TABLE customers ADD COLUMN deleted_at TEXT;
ALTER TABLE followups ADD COLUMN deleted_at TEXT;
CREATE INDEX customers_active_tenant ON customers(tenant_id,deleted_at,created_at);
CREATE INDEX followups_active_tenant ON followups(tenant_id,deleted_at,due);

ALTER TABLE attachments ADD COLUMN deleted_at TEXT;
CREATE INDEX attachments_deleted_at ON attachments(deleted_at);
CREATE INDEX customers_deleted_at ON customers(deleted_at);
CREATE INDEX exams_deleted_at ON exams(deleted_at);
CREATE INDEX fittings_deleted_at ON fittings(deleted_at);
CREATE INDEX followups_deleted_at ON followups(deleted_at);
