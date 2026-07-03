-- Org hierarchy managers + agent self-registration

ALTER TABLE org_teams
  ADD COLUMN IF NOT EXISTS tl_employee_id text;

CREATE TABLE IF NOT EXISTS org_unit_managers (
  unit text PRIMARY KEY,
  company text NOT NULL DEFAULT 'hangup',
  op_employee_id text,
  hr_manager_id text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO org_unit_managers (unit, company, notes)
VALUES
  ('HS-Back-End', 'hangup', 'No OP — reports to CEO directly'),
  ('HS-MGMT', 'hangup', 'Backend support units')
ON CONFLICT (unit) DO NOTHING;

CREATE TABLE IF NOT EXISTS registration_daily_pins (
  pin_date date PRIMARY KEY,
  pin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  american_name text NOT NULL,
  arabic_name text,
  phone text,
  email text,
  unit text,
  team text,
  username text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  employee_id text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_reg_status ON agent_registration_requests(status);

ALTER TABLE org_unit_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_daily_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_registration_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY deny_all_org_unit_managers ON org_unit_managers FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_registration_daily_pins ON registration_daily_pins FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_agent_registration_requests ON agent_registration_requests FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
