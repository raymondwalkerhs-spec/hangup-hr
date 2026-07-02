-- Finance HR Attendance sprint: fp_number, employment alerts, loan requests, saved reports, import audit

ALTER TABLE employees ADD COLUMN IF NOT EXISTS fp_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_end_date date;
CREATE INDEX IF NOT EXISTS idx_employees_fp_number ON employees(fp_number) WHERE fp_number IS NOT NULL;

ALTER TABLE attendance_events ADD COLUMN IF NOT EXISTS fp_notes text;

CREATE TABLE IF NOT EXISTS loan_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  total_amount numeric NOT NULL,
  installment_amount numeric DEFAULT 0,
  installments_count integer DEFAULT 0,
  skip_current_month boolean DEFAULT false,
  notes text DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  submitted_by text NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  deny_reason text DEFAULT '',
  created_loan_id uuid REFERENCES employee_loans(id) ON DELETE SET NULL,
  created_year_month text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loan_requests_status ON loan_requests(status);
CREATE INDEX IF NOT EXISTS idx_loan_requests_employee ON loan_requests(employee_id);

CREATE TABLE IF NOT EXISTS saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('employees', 'attendance', 'payroll')),
  filters jsonb DEFAULT '{}'::jsonb,
  columns jsonb DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_reports_created_by ON saved_reports(created_by);

CREATE TABLE IF NOT EXISTS attendance_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text NOT NULL,
  file_name text DEFAULT '',
  rows_parsed integer DEFAULT 0,
  rows_applied integer DEFAULT 0,
  rows_skipped integer DEFAULT 0,
  preview jsonb DEFAULT '{}'::jsonb,
  imported_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE expense_requests ADD COLUMN IF NOT EXISTS deny_reason text DEFAULT '';

ALTER TABLE loan_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_imports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'loan_requests' AND policyname = 'deny_all_loan_requests') THEN
    CREATE POLICY deny_all_loan_requests ON loan_requests FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'saved_reports' AND policyname = 'deny_all_saved_reports') THEN
    CREATE POLICY deny_all_saved_reports ON saved_reports FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_imports' AND policyname = 'deny_all_attendance_imports') THEN
    CREATE POLICY deny_all_attendance_imports ON attendance_imports FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;
