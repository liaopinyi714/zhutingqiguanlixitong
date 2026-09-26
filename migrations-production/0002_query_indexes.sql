CREATE INDEX fittings_customer ON fittings(tenant_id,customer_id,deleted_at,date);
CREATE INDEX followups_customer ON followups(tenant_id,customer_id,deleted_at);
CREATE INDEX attachments_customer ON attachments(tenant_id,customer_id,deleted_at);
CREATE INDEX audit_customer ON audit(tenant_id,customer_id,created_at);
CREATE INDEX sessions_expiry ON sessions(expires_at);
