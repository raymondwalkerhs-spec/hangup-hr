-- Agent payslip visibility (HR releases payslip to agent per month)
ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS payslip_visible_to_agent boolean DEFAULT false;

-- Temporary sales visibility grants (e.g. OP grants TL 24h wider view)
ALTER TABLE sales_visibility_grants ADD COLUMN IF NOT EXISTS expires_at timestamptz;
