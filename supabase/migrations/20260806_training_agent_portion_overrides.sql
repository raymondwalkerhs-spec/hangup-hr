-- Per-portion net overrides for dual training/agent payroll months
ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS training_net_salary_override numeric;
ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS agent_net_salary_override numeric;
ALTER TABLE payroll_adjustments ADD COLUMN IF NOT EXISTS training_payroll_paid boolean DEFAULT false;

COMMENT ON COLUMN payroll_adjustments.training_net_salary_override IS 'Manual net for training portion only (dual or training-only month)';
COMMENT ON COLUMN payroll_adjustments.agent_net_salary_override IS 'Manual net for agent portion only (dual promotion month)';
COMMENT ON COLUMN payroll_adjustments.training_payroll_paid IS 'When true, training portion net is zero (paid elsewhere / waived)';
