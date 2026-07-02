-- Organization teams registry (unit assignment + dial roster flag)

CREATE TABLE IF NOT EXISTS org_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  unit text NOT NULL DEFAULT 'HS-1',
  display_order int NOT NULL DEFAULT 0,
  dials_sales boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_teams_unit ON org_teams(unit);

-- Seed dialing teams from roster (idempotent)
INSERT INTO org_teams (name, unit, display_order, dials_sales)
VALUES
  ('Jude', 'HS-1', 10, true),
  ('Kate', 'HS-1', 20, true),
  ('Justin', 'HS-1', 30, true),
  ('Tris', 'HS-1', 40, true),
  ('Steven', 'HS-1', 50, true),
  ('Ayla', 'HS-1', 60, true),
  ('Daemon', 'HS-1', 70, false),
  ('Back-End', 'HS-MGMT', 80, false),
  ('HR', 'HS-MGMT', 90, false),
  ('Quality', 'HS-MGMT', 100, false)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE org_teams ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY deny_all_org_teams ON org_teams FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
