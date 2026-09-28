CREATE TABLE IF NOT EXISTS accounts (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  store_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('config', 'managed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS accounts_tenant ON accounts(tenant_id);
