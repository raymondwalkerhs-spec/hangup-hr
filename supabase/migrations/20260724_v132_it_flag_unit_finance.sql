-- v1.32: IT Access flag on app_users, unit on loan_requests, leave_request_documents table

-- 1. IT Access flag — any user can be marked as IT staff for ticket routing
--    regardless of their role. This replaces the role=it lookup.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS is_it boolean DEFAULT false;

-- Backfill: existing users with role='it' get is_it=true
UPDATE app_users SET is_it = true WHERE role = 'it';

CREATE INDEX IF NOT EXISTS idx_app_users_is_it ON app_users(is_it) WHERE is_it = true;

-- 2. Unit column on loan_requests (for unit-scoped finance)
ALTER TABLE loan_requests
  ADD COLUMN IF NOT EXISTS unit text;

-- Backfill unit from employee record
UPDATE loan_requests lr
SET unit = e.unit
FROM employees e
WHERE e.id = lr.employee_id
  AND lr.unit IS NULL;

CREATE INDEX IF NOT EXISTS idx_loan_requests_unit ON loan_requests(unit);

-- 3. Leave request documents — attach sick notes / exam schedules directly to a leave request
CREATE TABLE IF NOT EXISTS leave_request_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_id      uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  employee_id   text NOT NULL,
  doc_type      text NOT NULL DEFAULT 'medical_note',
  file_name     text NOT NULL,
  storage_path  text,
  drive_file_id text,
  notes         text,
  uploaded_by   text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_docs_leave  ON leave_request_documents(leave_id);
CREATE INDEX IF NOT EXISTS idx_leave_docs_emp    ON leave_request_documents(employee_id);

-- RLS deny-all
ALTER TABLE leave_request_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY deny_all_leave_request_documents ON leave_request_documents
    FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
