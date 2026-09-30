ALTER TABLE store_memberships ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
ALTER TABLE stores ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS stores_deleted_at ON stores(deleted_at);
