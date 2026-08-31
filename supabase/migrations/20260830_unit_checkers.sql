-- Unit checkers: assign employees who may submit/edit RPM checks for a unit

CREATE TABLE IF NOT EXISTS unit_checkers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit text NOT NULL,
  employee_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(unit, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_checkers_unit ON unit_checkers(unit);
CREATE INDEX IF NOT EXISTS idx_unit_checkers_employee ON unit_checkers(employee_id);

ALTER TABLE unit_checkers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'unit_checkers' AND policyname = 'deny_all_unit_checkers'
  ) THEN
    CREATE POLICY deny_all_unit_checkers ON unit_checkers FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;
