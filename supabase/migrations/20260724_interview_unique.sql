-- Add unique constraint for form-submit upsert deduplication
-- The Apps Script syncs using on_conflict=timestamp,name

ALTER TABLE candidate_applications
  ADD CONSTRAINT IF NOT EXISTS candidate_applications_timestamp_name_key
  UNIQUE (timestamp, name);
