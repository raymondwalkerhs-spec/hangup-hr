-- Extra Payroll Entries
-- Manual extra payroll entries with custom labels

CREATE TABLE IF NOT EXISTS extra_payroll_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year_month text NOT NULL,
  label text NOT NULL DEFAULT 'Extra',
  working_days numeric DEFAULT 0,
  daily_rate numeric DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  created_by text,
  updated_by text
);

CREATE INDEX IF NOT EXISTS idx_extra_payroll_entries_employee_month ON extra_payroll_entries(employee_id, year_month);

ALTER TABLE extra_payroll_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access extra_payroll_entries"
  ON extra_payroll_entries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION update_extra_payroll_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_extra_payroll_entries_updated_at ON extra_payroll_entries;
CREATE TRIGGER trg_extra_payroll_entries_updated_at
  BEFORE UPDATE ON extra_payroll_entries
  FOR EACH ROW EXECUTE FUNCTION update_extra_payroll_updated_at();
