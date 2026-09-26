ALTER TABLE attachments ADD COLUMN deleted_at TEXT;
CREATE INDEX attachments_deleted_at ON attachments(deleted_at);
CREATE INDEX customers_deleted_at ON customers(deleted_at);
CREATE INDEX exams_deleted_at ON exams(deleted_at);
CREATE INDEX fittings_deleted_at ON fittings(deleted_at);
CREATE INDEX followups_deleted_at ON followups(deleted_at);
