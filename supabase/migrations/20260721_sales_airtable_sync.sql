-- Outbound Airtable sync metadata on sales rows
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS airtable_record_id text,
  ADD COLUMN IF NOT EXISTS airtable_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS airtable_sync_error text;

CREATE INDEX IF NOT EXISTS sales_airtable_record_id_idx ON sales (airtable_record_id)
  WHERE airtable_record_id IS NOT NULL;
