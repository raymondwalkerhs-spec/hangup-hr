-- Team closers: agents who can submit sales / IT on behalf for a team (not TL).
CREATE TABLE IF NOT EXISTS team_closers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES org_teams(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_team_closers_team ON team_closers(team_id);
CREATE INDEX IF NOT EXISTS idx_team_closers_employee ON team_closers(employee_id);

ALTER TABLE team_closers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY deny_all_team_closers ON team_closers FOR ALL TO anon, authenticated USING (false);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
