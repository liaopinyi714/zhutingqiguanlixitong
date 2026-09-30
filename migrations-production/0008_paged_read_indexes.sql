-- Seek by immutable tie-breaker ID; no OFFSET walk and no index of report bytes.
CREATE INDEX customers_page ON customers(tenant_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX customers_status_page ON customers(tenant_id,status,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX customers_summary ON customers(tenant_id,status,source,birth_date) WHERE deleted_at IS NULL;
CREATE INDEX customers_duplicate ON customers(tenant_id,name,birth_date) WHERE deleted_at IS NULL;
CREATE INDEX customers_removed_page ON customers(tenant_id,deleted_at DESC,id DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX fittings_page ON fittings(tenant_id,date DESC,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX fittings_side_page ON fittings(tenant_id,json_extract(data,'$.side'),date DESC,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX fittings_warranty_page ON fittings(tenant_id,COALESCE(NULLIF(json_extract(data,'$.warranty'),''),'9999'),id) WHERE deleted_at IS NULL;
CREATE INDEX repairs_page ON repairs(tenant_id,CASE status WHEN '待送修' THEN 2 WHEN '维修中' THEN 1 ELSE 0 END DESC,occurred_date DESC,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX repairs_status_page ON repairs(tenant_id,status,CASE status WHEN '待送修' THEN 2 WHEN '维修中' THEN 1 ELSE 0 END DESC,occurred_date DESC,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX followups_page ON followups(tenant_id,completed,due,id) WHERE deleted_at IS NULL;
