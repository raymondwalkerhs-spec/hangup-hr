-- v1.9.3 Expense requests company isolation
-- Adds company column to expense_requests and backfills from unit

-- ============================================================
-- 1. expense_requests - add company column
-- ============================================================
ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

CREATE INDEX IF NOT EXISTS idx_expense_requests_company ON expense_requests(company);

-- Backfill company from unit via employees table
UPDATE expense_requests er
SET company = COALESCE(
  (SELECT company FROM employees WHERE id = er.submitted_by AND company IS NOT NULL),
  (SELECT company FROM employees WHERE unit = er.unit AND company IS NOT NULL LIMIT 1),
  'hangup'
)
WHERE er.company IS NULL;
