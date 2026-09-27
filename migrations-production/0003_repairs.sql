CREATE TABLE repairs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  fitting_id TEXT NOT NULL REFERENCES fittings(id),
  occurred_date TEXT NOT NULL,
  received_date TEXT NOT NULL DEFAULT '',
  completed_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  problem TEXT NOT NULL,
  findings TEXT NOT NULL DEFAULT '',
  work_done TEXT NOT NULL DEFAULT '',
  parts TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL DEFAULT 0,
  warranty_covered INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX repairs_customer ON repairs(tenant_id,customer_id,deleted_at,occurred_date);
CREATE INDEX repairs_fitting ON repairs(fitting_id,deleted_at);
