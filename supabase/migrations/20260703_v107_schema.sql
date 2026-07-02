-- v1.0.7: unified requests, paid leave, employee notice, app user login tracking

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS paid_leave boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_submission boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS requested_by text,
  ADD COLUMN IF NOT EXISTS requested_by_role text,
  ADD COLUMN IF NOT EXISTS request_kind text DEFAULT 'annual';

ALTER TABLE attendance_events
  ADD COLUMN IF NOT EXISTS paid_leave boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS leave_note text;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS notice_type text,
  ADD COLUMN IF NOT EXISTS employee_user_id text;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS employee_id text;

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
