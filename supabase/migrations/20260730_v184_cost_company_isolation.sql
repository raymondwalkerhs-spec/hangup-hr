-- v1.9.2 Cost Management company isolation
-- Adds company columns to cost tables and backfills from org_unit_managers

-- ============================================================
-- 1. Monthly bills - add company column
-- ============================================================
ALTER TABLE monthly_bills
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

CREATE INDEX IF NOT EXISTS idx_monthly_bills_company ON monthly_bills(company);

-- Backfill company from unit via org_unit_managers
UPDATE monthly_bills mb
SET company = COALESCE(
  (SELECT company FROM org_unit_managers WHERE unit = mb.unit AND company IS NOT NULL),
  'hangup'
)
WHERE mb.company IS NULL;

-- ============================================================
-- 2. Petty cash funds - add company column
-- ============================================================
ALTER TABLE petty_cash_funds
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

CREATE INDEX IF NOT EXISTS idx_petty_cash_funds_company ON petty_cash_funds(company);

UPDATE petty_cash_funds pcf
SET company = COALESCE(
  (SELECT company FROM org_unit_managers WHERE unit = pcf.unit AND company IS NOT NULL),
  'hangup'
)
WHERE pcf.company IS NULL;

-- ============================================================
-- 3. Petty cash ledger - add company column
-- ============================================================
ALTER TABLE petty_cash_ledger
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

CREATE INDEX IF NOT EXISTS idx_petty_cash_ledger_company ON petty_cash_ledger(company);

UPDATE petty_cash_ledger pcl
SET company = COALESCE(
  (SELECT company FROM org_unit_managers WHERE unit = pcl.unit AND company IS NOT NULL),
  'hangup'
)
WHERE pcl.company IS NULL;
