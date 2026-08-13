-- Phase 1: Rules content storage, IT requests, meeting requests, multiple TL/OP, HS2 separation

-- 1A. Rules content storage (editable per-company)
CREATE TABLE IF NOT EXISTS rules_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL CHECK (company IN ('hangup', 'hs2')),
  section_key text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  sort_order integer DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  updated_by text,
  UNIQUE(company, section_key)
);

-- 1B. Team TLs join table (multiple TLs per team)
CREATE TABLE IF NOT EXISTS team_tls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES org_teams(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(team_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_team_tls_team ON team_tls(team_id);
CREATE INDEX IF NOT EXISTS idx_team_tls_employee ON team_tls(employee_id);

-- 1C. Unit OPs join table (multiple OPs per unit)
CREATE TABLE IF NOT EXISTS unit_ops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit text NOT NULL,
  employee_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(unit, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_ops_unit ON unit_ops(unit);
CREATE INDEX IF NOT EXISTS idx_unit_ops_employee ON unit_ops(employee_id);

-- Backfill: migrate existing single OP into unit_ops
INSERT INTO unit_ops (unit, employee_id)
SELECT unit, op_employee_id
FROM org_unit_managers
WHERE op_employee_id IS NOT NULL AND op_employee_id != ''
ON CONFLICT (unit, employee_id) DO NOTHING;

-- 1D. IT Requests table
CREATE TABLE IF NOT EXISTS it_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'other',
  urgency text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  assigned_to text,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  resolution_notes text,
  notes_hidden_from_requester text
);

CREATE INDEX IF NOT EXISTS idx_it_requests_employee ON it_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_it_requests_status ON it_requests(status);
CREATE INDEX IF NOT EXISTS idx_it_requests_assigned ON it_requests(assigned_to);

-- 1E. IT Request visibility scope
CREATE TABLE IF NOT EXISTS it_request_scope (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES it_requests(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('employee', 'team', 'unit')),
  scope_value text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_it_request_scope_request ON it_request_scope(request_id);

-- 1F. Meeting Requests table
CREATE TABLE IF NOT EXISTS meeting_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  proposed_date date NOT NULL,
  proposed_time time NOT NULL,
  duration_minutes integer DEFAULT 30,
  requester_employee_id text NOT NULL,
  requester_role text NOT NULL,
  participants jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending',
  reviewed_by text,
  review_notes text,
  rescheduled_proposal jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_requests_requester ON meeting_requests(requester_employee_id);
CREATE INDEX IF NOT EXISTS idx_meeting_requests_status ON meeting_requests(status);

-- 1G. Company column on position_rates (for HS2/Hangup separation)
ALTER TABLE position_rates
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

ALTER TABLE position_rate_monthly
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

-- 1H. Quality manager column on org_unit_managers
ALTER TABLE org_unit_managers
  ADD COLUMN IF NOT EXISTS quality_manager_id text;

-- 1I. Seed notification routing rules for new features
INSERT INTO notification_routing_rules (action_key, label, description, recipient_roles, recipient_usernames)
VALUES
  ('it_request_submitted', 'IT request submitted', 'When a new IT request is created', '{it,admin,ceo}', '{}'),
  ('it_request_assigned', 'IT request assigned', 'When an IT request is assigned to someone', '{it,admin,ceo}', '{}'),
  ('it_request_resolved', 'IT request resolved', 'When an IT request is marked resolved', '{it,admin,ceo,hr}', '{}'),
  ('meeting_request_submitted', 'Meeting request submitted', 'When a new meeting request is created', '{admin,ceo,hr}', '{}'),
  ('meeting_request_reviewed', 'Meeting request reviewed', 'When a meeting request is approved/rejected', '{admin,ceo,hr}', '{}')
ON CONFLICT (action_key) DO NOTHING;

-- Enable RLS on new tables
ALTER TABLE rules_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_tls ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE it_request_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_requests ENABLE ROW LEVEL SECURITY;

-- Deny-all policies for all new tables (backend uses service role)
DO $$ BEGIN
  CREATE POLICY deny_all_rules_content ON rules_content FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY deny_all_team_tls ON team_tls FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY deny_all_unit_ops ON unit_ops FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY deny_all_it_requests ON it_requests FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY deny_all_it_request_scope ON it_request_scope FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY deny_all_meeting_requests ON meeting_requests FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
