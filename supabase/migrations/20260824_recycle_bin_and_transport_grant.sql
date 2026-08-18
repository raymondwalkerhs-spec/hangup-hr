-- Recycle bin archive (do NOT add deleted_at on live ticket tables).
-- Full-month transport grant flag on payroll_adjustments.

CREATE TABLE IF NOT EXISTS recycle_bin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL DEFAULT 'hangup',
  source_table text NOT NULL,
  source_id text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_paths text[] NOT NULL DEFAULT '{}',
  deleted_by text,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recycle_bin_company_deleted_idx
  ON recycle_bin (company, deleted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS recycle_bin_source_idx
  ON recycle_bin (source_table, source_id);

ALTER TABLE recycle_bin ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'recycle_bin' AND policyname = 'recycle_bin_deny_all'
  ) THEN
    CREATE POLICY recycle_bin_deny_all ON recycle_bin FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

ALTER TABLE payroll_adjustments
  ADD COLUMN IF NOT EXISTS full_transport_grant boolean NOT NULL DEFAULT false;
