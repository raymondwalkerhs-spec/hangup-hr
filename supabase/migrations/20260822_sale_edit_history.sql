-- Portal-owned sale edit history (MLA + RPM). Not synced from Airtable.
CREATE TABLE IF NOT EXISTS sale_edit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program text NOT NULL CHECK (program IN ('mla', 'rpm')),
  sale_id text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL DEFAULT '',
  field_key text NOT NULL,
  field_label text,
  old_value text,
  new_value text,
  old_display text,
  new_display text,
  source text NOT NULL DEFAULT 'edit'
    CHECK (source IN ('edit', 'quality_ticket', 'submission_correction', 'create', 'delete', 'attachment'))
);

CREATE INDEX IF NOT EXISTS sale_edit_history_sale_idx
  ON sale_edit_history (program, sale_id, changed_at DESC);

ALTER TABLE sale_edit_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sale_edit_history' AND policyname = 'deny_all_sale_edit_history'
  ) THEN
    CREATE POLICY deny_all_sale_edit_history
      ON sale_edit_history FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;
