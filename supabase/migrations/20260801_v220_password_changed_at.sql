-- v2.2.0: Session invalidation via password_changed_at (NULL default — no backfill)
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz DEFAULT NULL;
