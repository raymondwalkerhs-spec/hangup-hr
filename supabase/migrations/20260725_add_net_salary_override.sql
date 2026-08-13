-- Add net_salary_override to payroll_adjustments
ALTER TABLE payroll_adjustments
  ADD COLUMN IF NOT EXISTS net_salary_override numeric;

COMMENT ON COLUMN payroll_adjustments.net_salary_override IS 'Optional manual net salary override (replaces calculated netSalary for the month)';
