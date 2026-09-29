CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS store_memberships (
  email TEXT NOT NULL COLLATE NOCASE,
  tenant_id TEXT NOT NULL REFERENCES stores(id),
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('config', 'managed')),
  last_seen_at INTEGER,
  PRIMARY KEY(email, tenant_id)
);
CREATE INDEX IF NOT EXISTS store_memberships_store ON store_memberships(tenant_id, enabled);
INSERT OR IGNORE INTO stores(id, name)
SELECT tenant_id, MAX(store_name) FROM accounts GROUP BY tenant_id;
INSERT OR IGNORE INTO store_memberships(email, tenant_id, name, enabled, source)
SELECT email, tenant_id, name, enabled, source FROM accounts;
