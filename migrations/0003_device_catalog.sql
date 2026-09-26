CREATE TABLE device_brands (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX device_brands_active_name ON device_brands(tenant_id,name) WHERE active=1;
CREATE TABLE device_series (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, brand_id TEXT NOT NULL REFERENCES device_brands(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX device_series_active_name ON device_series(tenant_id,brand_id,name) WHERE active=1;
CREATE INDEX device_series_brand ON device_series(tenant_id,brand_id,active);
CREATE TABLE device_models (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, series_id TEXT NOT NULL REFERENCES device_series(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX device_models_active_name ON device_models(tenant_id,series_id,name) WHERE active=1;
CREATE INDEX device_models_series ON device_models(tenant_id,series_id,active);

-- Fictional demonstration catalog; production data is not seeded.
INSERT INTO device_brands(id,tenant_id,name) VALUES('demo-brand-phonak','demo-store','峰力');
INSERT INTO device_series(id,tenant_id,brand_id,name) VALUES('demo-series-lumity','demo-store','demo-brand-phonak','Lumity');
INSERT INTO device_models(id,tenant_id,series_id,name) VALUES('demo-model-audeo','demo-store','demo-series-lumity','Audeo L50-R');
INSERT INTO device_brands(id,tenant_id,name) VALUES('demo-brand-oticon','demo-store','奥迪康');
INSERT INTO device_series(id,tenant_id,brand_id,name) VALUES('demo-series-real','demo-store','demo-brand-oticon','Real');
INSERT INTO device_models(id,tenant_id,series_id,name) VALUES('demo-model-real','demo-store','demo-series-real','Real 2 miniRITE R');
INSERT INTO device_brands(id,tenant_id,name) VALUES('demo-brand-resound','demo-store','瑞声达');
INSERT INTO device_series(id,tenant_id,brand_id,name) VALUES('demo-series-omnia','demo-store','demo-brand-resound','OMNIA');
INSERT INTO device_models(id,tenant_id,series_id,name) VALUES('demo-model-omnia','demo-store','demo-series-omnia','OMNIA 5');
