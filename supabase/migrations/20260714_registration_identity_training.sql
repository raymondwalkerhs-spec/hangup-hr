-- Registration identity fields, training_passed flag, profile metadata

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS passport_number text,
  ADD COLUMN IF NOT EXISTS training_passed boolean NOT NULL DEFAULT false;

ALTER TABLE agent_registration_requests
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS passport_number text;

ALTER TABLE agent_registration_requests
  ALTER COLUMN username DROP NOT NULL;

COMMENT ON COLUMN employees.national_id IS 'Egyptian National ID (14 digits)';
COMMENT ON COLUMN employees.passport_number IS 'Passport number for non-Egyptian employees';
COMMENT ON COLUMN employees.training_passed IS 'Baseline training completed; HR may still start a new program';
