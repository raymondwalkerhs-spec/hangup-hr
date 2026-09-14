-- Permanent WFH agents (e.g. Kate) — excluded from Office PO AvgAuto headcount.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS wfh boolean DEFAULT false;
COMMENT ON COLUMN employees.wfh IS 'Work-from-home agent; excluded from Office PO average headcount';
