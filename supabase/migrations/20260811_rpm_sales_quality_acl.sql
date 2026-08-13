-- RPM sales program: sales table, attachments, field/attachment/list-column permissions

CREATE TABLE IF NOT EXISTS rpm_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  full_name text NOT NULL,
  client text,
  member_id text,
  agent_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  closer_id text REFERENCES employees(id) ON DELETE SET NULL,
  submitted_by text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('passed', 'pending', 'denied', 'callback')),
  submission_date date NOT NULL DEFAULT CURRENT_DATE,
  submission_time text,
  working_day text,
  effective_date date,
  feedback text,
  team text,
  unit text,
  reviewed_by text,
  reviewed_at timestamptz,
  form_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rpm_sales_agent ON rpm_sales(agent_id);
CREATE INDEX IF NOT EXISTS idx_rpm_sales_status ON rpm_sales(status);
CREATE INDEX IF NOT EXISTS idx_rpm_sales_submission ON rpm_sales(submission_date);
CREATE INDEX IF NOT EXISTS idx_rpm_sales_team ON rpm_sales(team);

CREATE TABLE IF NOT EXISTS rpm_sales_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rpm_sale_id uuid NOT NULL REFERENCES rpm_sales(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('recording', 'quality_record', 'raw_call')),
  file_name text NOT NULL,
  dropbox_path text NOT NULL,
  dropbox_link text,
  uploaded_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rpm_sales_attachments_sale ON rpm_sales_attachments(rpm_sale_id);

CREATE TABLE IF NOT EXISTS rpm_sales_field_permissions (
  field_key text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  section text DEFAULT 'general',
  sensitive boolean DEFAULT false,
  view_roles text[] NOT NULL DEFAULT ARRAY['admin','hr','finance'],
  edit_roles text[] NOT NULL DEFAULT ARRAY['admin','hr'],
  main_view_roles text[] NOT NULL DEFAULT '{}',
  quality_view_roles text[] NOT NULL DEFAULT '{}',
  display_order integer DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rpm_sales_attachment_permissions (
  attachment_key text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  view_roles text[] NOT NULL DEFAULT ARRAY['admin','hr'],
  edit_roles text[] NOT NULL DEFAULT ARRAY['admin','hr'],
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rpm_sales_list_column_config (
  column_key text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  display_order integer DEFAULT 0,
  admin_only boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE rpm_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpm_sales_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpm_sales_field_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpm_sales_attachment_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpm_sales_list_column_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rpm_sales' AND policyname = 'deny_all_rpm_sales') THEN
    CREATE POLICY deny_all_rpm_sales ON rpm_sales FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rpm_sales_attachments' AND policyname = 'deny_all_rpm_sales_attachments') THEN
    CREATE POLICY deny_all_rpm_sales_attachments ON rpm_sales_attachments FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rpm_sales_field_permissions' AND policyname = 'deny_all_rpm_sales_field_permissions') THEN
    CREATE POLICY deny_all_rpm_sales_field_permissions ON rpm_sales_field_permissions FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rpm_sales_attachment_permissions' AND policyname = 'deny_all_rpm_sales_attachment_permissions') THEN
    CREATE POLICY deny_all_rpm_sales_attachment_permissions ON rpm_sales_attachment_permissions FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rpm_sales_list_column_config' AND policyname = 'deny_all_rpm_sales_list_column_config') THEN
    CREATE POLICY deny_all_rpm_sales_list_column_config ON rpm_sales_list_column_config FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;
