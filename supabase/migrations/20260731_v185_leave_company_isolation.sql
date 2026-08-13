-- v1.9.3 Leave Requests company isolation
-- Adds company column to leave_requests and backfills from employee records

-- ============================================================
-- 1. leave_requests - add company column
-- ============================================================
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

CREATE INDEX IF NOT EXISTS idx_leave_requests_company ON leave_requests(company);

-- Backfill company from employee record via employee_id
UPDATE leave_requests lr
SET company = COALESCE(
  (SELECT company FROM employees WHERE id = lr.employee_id AND company IS NOT NULL),
  'hangup'
)
WHERE lr.company IS NULL;
