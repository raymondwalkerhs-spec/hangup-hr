-- Outbound Airtable sync metadata on RPM sales and Q Feedback (rpm_checks)
ALTER TABLE rpm_sales
  ADD COLUMN IF NOT EXISTS airtable_record_id text,
  ADD COLUMN IF NOT EXISTS airtable_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS airtable_sync_error text;

CREATE INDEX IF NOT EXISTS rpm_sales_airtable_record_id_idx ON rpm_sales (airtable_record_id)
  WHERE airtable_record_id IS NOT NULL;

ALTER TABLE rpm_checks
  ADD COLUMN IF NOT EXISTS airtable_record_id text,
  ADD COLUMN IF NOT EXISTS airtable_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS airtable_sync_error text;

CREATE INDEX IF NOT EXISTS rpm_checks_airtable_record_id_idx ON rpm_checks (airtable_record_id)
  WHERE airtable_record_id IS NOT NULL;
