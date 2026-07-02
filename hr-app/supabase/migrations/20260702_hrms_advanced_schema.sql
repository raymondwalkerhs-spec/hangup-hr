-- HRMS advanced features schema

ALTER TABLE employees ADD COLUMN IF NOT EXISTS depart_date date;

ALTER TABLE employee_documents ADD COLUMN IF NOT EXISTS no_expiry boolean DEFAULT false;

ALTER TABLE employee_warnings ADD COLUMN IF NOT EXISTS warning_level text;

CREATE TABLE IF NOT EXISTS employment_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date,
  is_current boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employment_periods_employee ON employment_periods(employee_id);

CREATE TABLE IF NOT EXISTS action_improvement_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aip_employee ON action_improvement_plans(employee_id);

CREATE TABLE IF NOT EXISTS onboarding_checklists (
  employee_id text PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  ad_user boolean DEFAULT false,
  id_scanned boolean DEFAULT false,
  contract boolean DEFAULT false,
  training_phase_1 boolean DEFAULT false,
  training_phase_2 boolean DEFAULT false,
  training_phase_3 boolean DEFAULT false,
  training_phase_4 boolean DEFAULT false,
  updated_by text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offboarding_checklists (
  employee_id text PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  revoke_access boolean DEFAULT false,
  final_pay boolean DEFAULT false,
  updated_by text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clearance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  updated_by text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, item_key)
);

CREATE TABLE IF NOT EXISTS equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag text NOT NULL UNIQUE,
  unit text,
  item_type text,
  description text,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  returned_at timestamptz,
  notes text,
  assigned_by text
);
CREATE INDEX IF NOT EXISTS idx_equipment_assign_emp ON equipment_assignments(employee_id);

CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  leave_type text NOT NULL DEFAULT 'annual',
  status text NOT NULL DEFAULT 'pending',
  approved_by text,
  notes text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL UNIQUE,
  name text NOT NULL,
  country text DEFAULT 'USA',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_month_locks (
  year_month text PRIMARY KEY,
  locked_at timestamptz DEFAULT now(),
  locked_by text,
  notes text
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id text PRIMARY KEY,
  username text NOT NULL,
  device_label text,
  ip text,
  created_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(username);

-- Backfill employment periods from existing employees
INSERT INTO employment_periods (employee_id, start_date, end_date, is_current, notes)
SELECT e.id,
  COALESCE(e.employment_date::date, CURRENT_DATE),
  e.depart_date,
  true,
  'Migrated from legacy employment_date'
FROM employees e
WHERE NOT EXISTS (
  SELECT 1 FROM employment_periods ep WHERE ep.employee_id = e.id
);

-- Default clearance item keys for existing out employees (optional seed handled in app)
