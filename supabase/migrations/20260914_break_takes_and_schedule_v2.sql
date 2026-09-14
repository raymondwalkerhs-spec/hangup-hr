-- Breaks v2: company/dialing/effective dates on schedules, break_takes, notifier config

ALTER TABLE break_schedules
  ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT 'hangup',
  ADD COLUMN IF NOT EXISTS dialing_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date;

-- Canonicalize legacy HS1/HS2/HS3 unit tags → HS-1/HS-2/HS-3
UPDATE break_schedules
SET units = (
  SELECT COALESCE(array_agg(
    CASE
      WHEN upper(trim(u)) ~ '^HS[[:space:]]*-?[[:space:]]*[0-9]+$' THEN
        'HS-' || regexp_replace(upper(trim(u)), '^HS[[:space:]]*-?[[:space:]]*', '')
      ELSE trim(u)
    END
  ), ARRAY[]::text[])
  FROM unnest(units) AS u
)
WHERE units IS NOT NULL AND cardinality(units) > 0;

CREATE TABLE IF NOT EXISTS break_takes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES break_schedules(id) ON DELETE SET NULL,
  employee_id text NOT NULL,
  username text,
  unit text,
  company text NOT NULL DEFAULT 'hangup',
  break_name text NOT NULL DEFAULT '',
  allowed_minutes integer NOT NULL DEFAULT 15,
  started_at timestamptz,
  ended_at timestamptz,
  dismissed_at timestamptz,
  egypt_date date NOT NULL,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'exceeded', 'dismissed', 'overdue')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_break_takes_egypt_date ON break_takes (egypt_date);
CREATE INDEX IF NOT EXISTS idx_break_takes_employee_date ON break_takes (employee_id, egypt_date);
CREATE INDEX IF NOT EXISTS idx_break_takes_company_date ON break_takes (company, egypt_date);
CREATE INDEX IF NOT EXISTS idx_break_takes_schedule ON break_takes (schedule_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_break_takes_one_open
  ON break_takes (employee_id, schedule_id, egypt_date)
  WHERE status IN ('in_progress', 'overdue') AND schedule_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS break_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO break_config (key, value)
VALUES ('notifier_extra_roles', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE break_takes ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'break_takes' AND policyname = 'deny_all_break_takes') THEN
    CREATE POLICY deny_all_break_takes ON break_takes FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'break_config' AND policyname = 'deny_all_break_config') THEN
    CREATE POLICY deny_all_break_config ON break_config FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;
