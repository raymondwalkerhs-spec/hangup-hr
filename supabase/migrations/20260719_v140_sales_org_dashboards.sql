-- v1.4.0: working day, list columns, sales access surfaces

ALTER TABLE sales ADD COLUMN IF NOT EXISTS working_day date;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS submission_time text;

CREATE TABLE IF NOT EXISTS sales_list_column_config (
  column_key text PRIMARY KEY,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  admin_only boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_field_permissions
  ADD COLUMN IF NOT EXISTS main_view_roles text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS quality_view_roles text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS sales_action_permissions (
  action_key text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  allowed_roles text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_list_column_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_action_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY deny_all_sales_list_columns ON sales_list_column_config FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY deny_all_sales_action_permissions ON sales_action_permissions FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
