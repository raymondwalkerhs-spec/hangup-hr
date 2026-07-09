-- v1.7.8 — Leave requests: ensure day_fraction columns exist + pause request kind
-- Safe to re-run (IF NOT EXISTS / DO NOTHING).

-- ============================================================
-- 1. Ensure day_fraction columns exist on leave_requests
--    (may not have been applied from v1.29 migration)
-- ============================================================
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS day_fraction   numeric(4,2) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS half_day       boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS half_day_part  text
    CHECK (half_day_part IN ('morning','afternoon') OR half_day_part IS NULL);

-- Back-fill any existing rows that have NULL (safe — only sets where missing)
UPDATE leave_requests
SET day_fraction = 1.0
WHERE day_fraction IS NULL;

-- ============================================================
-- 2. Allow 'pause' as a valid request_kind / leave_type
--    leave_requests has no CHECK constraint on these columns,
--    so no DDL change needed — this comment documents the value.
-- ============================================================
-- request_kind / leave_type values now in use:
--   annual, unpaid, medical, same_day, pause

-- Add index to support filtering by request_kind (if not present)
CREATE INDEX IF NOT EXISTS idx_leave_requests_request_kind ON leave_requests(request_kind);
