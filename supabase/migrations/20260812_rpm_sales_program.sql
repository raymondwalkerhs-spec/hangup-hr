-- RPM sales program: employee flags, client program, payroll split counts, action permissions

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS sales_mla_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_rpm_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE sales_clients
  ADD COLUMN IF NOT EXISTS sale_program text NOT NULL DEFAULT 'mla'
    CHECK (sale_program IN ('mla', 'rpm'));

ALTER TABLE payroll_adjustments
  ADD COLUMN IF NOT EXISTS sales_count_mla integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_count_rpm integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS rpm_sales_action_permissions (
  action_key text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  allowed_roles text[] NOT NULL DEFAULT ARRAY['admin','hr'],
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE rpm_sales_action_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rpm_sales_action_permissions' AND policyname = 'deny_all_rpm_sales_action_permissions'
  ) THEN
    CREATE POLICY deny_all_rpm_sales_action_permissions
      ON rpm_sales_action_permissions FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;

-- Backfill: active employees get RPM; preserve MLA for all active (existing behavior)
UPDATE employees
SET sales_rpm_enabled = true
WHERE lower(coalesce(status, '')) = 'active' AND sales_rpm_enabled = false;

UPDATE employees
SET sales_mla_enabled = true
WHERE lower(coalesce(status, '')) = 'active' AND sales_mla_enabled = false;

-- Seed RPM clients if missing
INSERT INTO sales_clients (name, status, sort_order, company, sale_program)
SELECT v.name, 'active', v.sort_order, 'hangup', 'rpm'
FROM (VALUES ('RPM1', 1), ('RPM2', 2)) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM sales_clients c WHERE lower(c.name) = lower(v.name) AND c.sale_program = 'rpm'
);
