-- Training payroll: program outcomes, phase exit reasons, Trainee position rate

ALTER TABLE agent_training_programs
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'active'
    CHECK (outcome IN ('active', 'passed', 'failed', 'voluntary_leave', 'company_terminated')),
  ADD COLUMN IF NOT EXISTS passed_on_date date,
  ADD COLUMN IF NOT EXISTS promotion_effective_date date,
  ADD COLUMN IF NOT EXISTS phase2_first_login_date date,
  ADD COLUMN IF NOT EXISTS exit_notes text;

ALTER TABLE agent_training_phases
  ADD COLUMN IF NOT EXISTS exit_reason text NOT NULL DEFAULT 'none'
    CHECK (exit_reason IN ('none', 'agent_left', 'company', 'failed_evaluation')),
  ADD COLUMN IF NOT EXISTS min_sales_required int NOT NULL DEFAULT 4;

INSERT INTO position_rates (position, monthly_salary)
VALUES ('Trainee', 0)
ON CONFLICT (position) DO NOTHING;

COMMENT ON COLUMN agent_training_programs.outcome IS 'Program result: active, passed, failed, voluntary_leave, company_terminated';
COMMENT ON COLUMN agent_training_programs.passed_on_date IS 'Date 12th passed sale validated (or HR confirm)';
COMMENT ON COLUMN agent_training_programs.promotion_effective_date IS 'First day Agent rate applies (dual payslip split)';
COMMENT ON COLUMN agent_training_programs.phase2_first_login_date IS 'First attendance day in phase 2 (company-exit pay window)';
