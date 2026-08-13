-- Manual training payroll anchor month when phase 4 dates are missing or HR needs override (YYYY-MM).
ALTER TABLE payroll_adjustments
  ADD COLUMN IF NOT EXISTS training_payroll_anchor_month text;

COMMENT ON COLUMN payroll_adjustments.training_payroll_anchor_month IS
  'HR override: accrual month for consolidated training pay (e.g. 2026-08). Overrides auto anchor from phase 4 end.';
