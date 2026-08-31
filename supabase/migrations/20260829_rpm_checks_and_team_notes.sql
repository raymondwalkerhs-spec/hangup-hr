-- RPM Checks + Q Feedback funnel; Team Dashboard agent notes; TL extra-team grants

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS can_submit_checks_q_feedback boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checks_submit_scope text NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS team_dashboard_extra_teams jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_checks_submit_scope_check'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_checks_submit_scope_check
      CHECK (checks_submit_scope IN ('self', 'team'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS rpm_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL DEFAULT 'hangup',
  agent_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  member_id text,
  member_id_normalized text,
  full_name text,
  date_of_birth date,
  phone text,
  phone_normalized text,
  team text,
  unit text,
  check_status text NOT NULL
    CHECK (check_status IN ('q', 'nq', 'age_limit', 'under_age', 'duplicate')),
  feedback_status text
    CHECK (
      feedback_status IS NULL
      OR feedback_status IN (
        'dropped_with_client',
        'callback',
        'not_int',
        'retransfer',
        'sale'
      )
    ),
  info text,
  submitted_by text,
  closer_id text REFERENCES employees(id) ON DELETE SET NULL,
  feedback_by text,
  feedback_at timestamptz,
  submission_date date,
  submission_time text,
  working_day date NOT NULL,
  linked_rpm_sale_id uuid REFERENCES rpm_sales(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rpm_checks_linked_sale
  ON rpm_checks (linked_rpm_sale_id)
  WHERE linked_rpm_sale_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rpm_checks_company_day
  ON rpm_checks (company, working_day)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rpm_checks_agent_member
  ON rpm_checks (agent_id, member_id_normalized)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rpm_checks_status
  ON rpm_checks (check_status, feedback_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rpm_checks_team_day
  ON rpm_checks (working_day, team)
  WHERE deleted_at IS NULL;

ALTER TABLE rpm_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon ON rpm_checks;
CREATE POLICY deny_anon ON rpm_checks
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_authenticated ON rpm_checks;
CREATE POLICY deny_authenticated ON rpm_checks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS team_dashboard_agent_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL DEFAULT 'hangup',
  agent_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  working_day date NOT NULL,
  note text NOT NULL DEFAULT '',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company, agent_id, working_day)
);

CREATE INDEX IF NOT EXISTS idx_team_dashboard_agent_notes_day
  ON team_dashboard_agent_notes (company, working_day);

ALTER TABLE team_dashboard_agent_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon ON team_dashboard_agent_notes;
CREATE POLICY deny_anon ON team_dashboard_agent_notes
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_authenticated ON team_dashboard_agent_notes;
CREATE POLICY deny_authenticated ON team_dashboard_agent_notes
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
