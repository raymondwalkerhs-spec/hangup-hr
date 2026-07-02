-- Employee nationality compliance fields (work permit + social insurance)

ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_permit text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_status text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_type text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_amount numeric;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_employee_deduction numeric;

COMMENT ON COLUMN employees.work_permit IS 'Non-Egyptian: have_permit | no_permit';
COMMENT ON COLUMN employees.insurance_status IS 'Egyptian: insured | not_insured';
COMMENT ON COLUMN employees.insurance_type IS 'Optional when insured';
COMMENT ON COLUMN employees.insurance_amount IS 'Optional total insurance amount when insured';
COMMENT ON COLUMN employees.insurance_employee_deduction IS 'Optional amount deducted from employee when insured';
