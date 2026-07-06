-- Per-role attachment kind view/edit (Sales permissions admin)
CREATE TABLE IF NOT EXISTS sales_attachment_permissions (
  attachment_key text PRIMARY KEY,
  label text,
  view_roles text[] NOT NULL DEFAULT '{}',
  edit_roles text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sales_attachment_permissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_attachment_permissions' AND policyname = 'deny_all_sales_attachment_permissions'
  ) THEN
    CREATE POLICY deny_all_sales_attachment_permissions ON sales_attachment_permissions
      FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;
