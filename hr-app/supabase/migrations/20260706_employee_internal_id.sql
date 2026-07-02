-- Stable database identity vs changeable app ID (employees.id)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS internal_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS archived_app_id text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_internal_id ON employees(internal_id);

-- Backfill internal_id for any legacy rows (DEFAULT handles new column)
UPDATE employees SET internal_id = gen_random_uuid() WHERE internal_id IS NULL;

-- Child tables: stable link via internal_id (historical rows survive app ID changes)
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'attendance_events',
    'bonus_events',
    'deduction_events',
    'payroll_adjustments',
    'employee_loans',
    'loan_payments',
    'payroll_splits',
    'employee_documents',
    'employee_warnings',
    'employment_periods',
    'leave_requests',
    'action_improvement_plans',
    'onboarding_checklists',
    'offboarding_checklists',
    'clearance_items',
    'equipment_assignments',
    'bonus_requests'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS employee_internal_id uuid REFERENCES employees(internal_id)',
      t
    );
    EXECUTE format(
      'UPDATE %I c SET employee_internal_id = e.internal_id FROM employees e WHERE e.id = c.employee_id AND c.employee_internal_id IS NULL',
      t
    );
  END LOOP;
END $$;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS agent_internal_id uuid REFERENCES employees(internal_id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS closer_internal_id uuid REFERENCES employees(internal_id);

UPDATE sales s SET agent_internal_id = e.internal_id FROM employees e WHERE e.id = s.agent_id AND s.agent_internal_id IS NULL;
UPDATE sales s SET closer_internal_id = e.internal_id FROM employees e WHERE e.id = s.closer_id AND s.closer_internal_id IS NULL;
