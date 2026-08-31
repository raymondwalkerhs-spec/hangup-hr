-- Weekly per-team RPM sales targets (Dashboard RPM weekly performance)

CREATE TABLE IF NOT EXISTS rpm_team_week_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL DEFAULT 'hangup',
  unit text NOT NULL DEFAULT '',
  team text NOT NULL,
  week_start date NOT NULL,
  target_count integer NOT NULL CHECK (target_count >= 1),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company, unit, team, week_start)
);

CREATE INDEX IF NOT EXISTS idx_rpm_team_week_targets_week
  ON rpm_team_week_targets (company, week_start);
CREATE INDEX IF NOT EXISTS idx_rpm_team_week_targets_team
  ON rpm_team_week_targets (company, unit, team);

ALTER TABLE rpm_team_week_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon ON rpm_team_week_targets;
CREATE POLICY deny_anon ON rpm_team_week_targets
  FOR ALL TO anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_authenticated ON rpm_team_week_targets;
CREATE POLICY deny_authenticated ON rpm_team_week_targets
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
