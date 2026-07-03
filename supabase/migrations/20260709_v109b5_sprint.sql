-- v1.0.9-beta.5: payroll exempt, sales MLA-Ray, team dedupe, payroll no-pay flag

ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_exempt boolean DEFAULT false;

ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS no_payroll boolean DEFAULT false;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS form_data jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS sales_field_permissions (
  field_key text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  section text DEFAULT 'general',
  sensitive boolean DEFAULT false,
  view_roles text[] NOT NULL DEFAULT ARRAY['admin','hr','finance'],
  edit_roles text[] NOT NULL DEFAULT ARRAY['admin','hr'],
  display_order integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('recording', 'receipt', 'quality_record', 'raw_call', 'confirmation')),
  file_name text NOT NULL,
  dropbox_path text NOT NULL,
  dropbox_link text,
  uploaded_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_attachments_sale ON sales_attachments(sale_id);

-- Case-insensitive unique team names
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_teams_name_lower ON org_teams (lower(trim(name)));

ALTER TABLE sales_field_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales_field_permissions' AND policyname = 'deny_all_sales_field_permissions') THEN
    CREATE POLICY deny_all_sales_field_permissions ON sales_field_permissions FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales_attachments' AND policyname = 'deny_all_sales_attachments') THEN
    CREATE POLICY deny_all_sales_attachments ON sales_attachments FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;
