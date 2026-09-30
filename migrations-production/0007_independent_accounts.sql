ALTER TABLE accounts ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
ALTER TABLE store_memberships ADD COLUMN left_at TEXT;
ALTER TABLE stores ADD COLUMN abandoned_at TEXT;
CREATE INDEX memberships_left ON store_memberships(email,left_at);
CREATE INDEX stores_abandoned ON stores(abandoned_at);

-- Keep the existing profile and prefer the avatar from the initial store.
UPDATE accounts SET name=COALESCE((
  SELECT m.name FROM store_memberships m WHERE m.email=accounts.email AND m.name<>''
  ORDER BY CASE WHEN m.tenant_id=accounts.tenant_id THEN 0 ELSE 1 END,m.tenant_id LIMIT 1
),name),avatar=COALESCE((
  SELECT m.avatar FROM store_memberships m WHERE m.email=accounts.email AND m.avatar<>''
  ORDER BY CASE WHEN m.tenant_id=accounts.tenant_id THEN 0 ELSE 1 END,m.tenant_id LIMIT 1
),'');
