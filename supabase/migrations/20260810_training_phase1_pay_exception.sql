-- Pay week 1 (phase 1) training basic by HR exception on anchor-month payslip
ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS training_phase1_pay_exception boolean DEFAULT false;

COMMENT ON COLUMN payroll_adjustments.training_phase1_pay_exception IS 'When true, include phase 1 (week 1) training basic in consolidated training payroll';
