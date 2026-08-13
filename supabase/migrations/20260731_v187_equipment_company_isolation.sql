-- v1.9.3 Equipment company isolation
-- Adds company column to equipment table and backfills from unit

-- ============================================================
-- 1. equipment - add company column
-- ============================================================
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

CREATE INDEX IF NOT EXISTS idx_equipment_company ON equipment(company);

-- Backfill company from unit via employees table or org_unit_managers
UPDATE equipment e
SET company = COALESCE(
  (SELECT company FROM employees WHERE unit = e.unit AND company IS NOT NULL LIMIT 1),
  (SELECT company FROM org_unit_managers WHERE unit = e.unit AND company IS NOT NULL),
  'hangup'
)
WHERE e.company IS NULL;
