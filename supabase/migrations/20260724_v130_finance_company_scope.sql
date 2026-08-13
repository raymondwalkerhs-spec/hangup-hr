-- v1.30 Finance company scope
-- Adds unit/company columns to finance tables for per-company separation
-- Loans, bonuses, deductions, and costs are now tied to each unit/company

-- ============================================================
-- 1. Employee loans - add unit column
-- ============================================================
ALTER TABLE employee_loans
  ADD COLUMN IF NOT EXISTS unit text;

CREATE INDEX IF NOT EXISTS idx_employee_loans_unit ON employee_loans(unit);

-- Backfill unit from employee
UPDATE employee_loans el
SET unit = e.unit
FROM employees e
WHERE el.employee_id = e.id AND el.unit IS NULL;

-- ============================================================
-- 2. Loan payments - add unit column
-- ============================================================
ALTER TABLE loan_payments
  ADD COLUMN IF NOT EXISTS unit text;

CREATE INDEX IF NOT EXISTS idx_loan_payments_unit ON loan_payments(unit);

-- Backfill unit from employee
UPDATE loan_payments lp
SET unit = e.unit
FROM employees e
WHERE lp.employee_id = e.id AND lp.unit IS NULL;

-- ============================================================
-- 3. Bonus events - add unit column
-- ============================================================
ALTER TABLE bonus_events
  ADD COLUMN IF NOT EXISTS unit text;

CREATE INDEX IF NOT EXISTS idx_bonus_events_unit ON bonus_events(unit);

-- Backfill unit from employee
UPDATE bonus_events be
SET unit = e.unit
FROM employees e
WHERE be.employee_id = e.id AND be.unit IS NULL;

-- ============================================================
-- 4. Deduction events - add unit column
-- ============================================================
ALTER TABLE deduction_events
  ADD COLUMN IF NOT EXISTS unit text;

CREATE INDEX IF NOT EXISTS idx_deduction_events_unit ON deduction_events(unit);

-- Backfill unit from employee
UPDATE deduction_events de
SET unit = e.unit
FROM employees e
WHERE de.employee_id = e.id AND de.unit IS NULL;

-- ============================================================
-- 5. Bonus requests - add unit column
-- ============================================================
ALTER TABLE bonus_requests
  ADD COLUMN IF NOT EXISTS unit text;

CREATE INDEX IF NOT EXISTS idx_bonus_requests_unit ON bonus_requests(unit);

-- Backfill unit from employee
UPDATE bonus_requests br
SET unit = e.unit
FROM employees e
WHERE br.employee_id = e.id AND br.unit IS NULL;

-- ============================================================
-- 6. Expense requests - add unit column
-- ============================================================
ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS unit text;

CREATE INDEX IF NOT EXISTS idx_expense_requests_unit ON expense_requests(unit);

-- Backfill unit from employee
UPDATE expense_requests er
SET unit = e.unit
FROM employees e
WHERE er.employee_id = e.id AND er.unit IS NULL;

-- ============================================================
-- 7. Monthly bills - add unit column
-- ============================================================
ALTER TABLE monthly_bills
  ADD COLUMN IF NOT EXISTS unit text;

CREATE INDEX IF NOT EXISTS idx_monthly_bills_unit ON monthly_bills(unit);

-- ============================================================
-- 8. Petty cash funds - add unit column
-- ============================================================
ALTER TABLE petty_cash_funds
  ADD COLUMN IF NOT EXISTS unit text;

CREATE INDEX IF NOT EXISTS idx_petty_cash_funds_unit ON petty_cash_funds(unit);

-- ============================================================
-- 9. Petty cash ledger - add unit column
-- ============================================================
ALTER TABLE petty_cash_ledger
  ADD COLUMN IF NOT EXISTS unit text;

CREATE INDEX IF NOT EXISTS idx_petty_cash_ledger_unit ON petty_cash_ledger(unit);
