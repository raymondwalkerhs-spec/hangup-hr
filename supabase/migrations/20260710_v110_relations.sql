-- v1.1.0: month-scoped position rates, app_users FK, sales internal_id sync

CREATE TABLE IF NOT EXISTS position_rate_monthly (
  year_month text NOT NULL,
  position text NOT NULL,
  monthly_salary numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (year_month, position)
);

CREATE INDEX IF NOT EXISTS idx_position_rate_monthly_month ON position_rate_monthly(year_month);

-- Seed snapshots from global position_rates for months that have payroll data
INSERT INTO position_rate_monthly (year_month, position, monthly_salary, updated_at)
SELECT DISTINCT pa.year_month, pr.position, pr.monthly_salary, now()
FROM position_rates pr
CROSS JOIN (SELECT DISTINCT year_month FROM payroll_adjustments) pa
ON CONFLICT (year_month, position) DO NOTHING;

-- Also seed current month if no payroll_adjustments yet
INSERT INTO position_rate_monthly (year_month, position, monthly_salary, updated_at)
SELECT to_char(CURRENT_DATE, 'YYYY-MM'), pr.position, pr.monthly_salary, now()
FROM position_rates pr
ON CONFLICT (year_month, position) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_app_users_employee_id ON app_users(employee_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_users_employee_id_fkey'
  ) THEN
    ALTER TABLE app_users
      ADD CONSTRAINT app_users_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'app_users FK skip: %', SQLERRM;
END $$;

-- Backfill sales internal_id columns where missing
UPDATE sales s
SET agent_internal_id = e.internal_id
FROM employees e
WHERE s.agent_id = e.id AND s.agent_internal_id IS NULL AND e.internal_id IS NOT NULL;

UPDATE sales s
SET closer_internal_id = e.internal_id
FROM employees e
WHERE s.closer_id = e.id AND s.closer_internal_id IS NULL AND e.internal_id IS NOT NULL;

ALTER TABLE position_rate_monthly ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'position_rate_monthly' AND policyname = 'deny_all_position_rate_monthly') THEN
    CREATE POLICY deny_all_position_rate_monthly ON position_rate_monthly FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;
