-- Agent 4-week training program (Mon–Fri phases)

CREATE TABLE IF NOT EXISTS agent_training_programs (
  employee_id text PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  phase1_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE IF NOT EXISTS agent_training_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  phase_number int NOT NULL CHECK (phase_number BETWEEN 1 AND 4),
  week_start date NOT NULL,
  week_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'passed', 'rejected', 'passed_exception')),
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (employee_id, phase_number)
);

CREATE INDEX IF NOT EXISTS idx_training_phases_employee ON agent_training_phases(employee_id);

ALTER TABLE agent_training_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_training_phases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY deny_all_agent_training_programs ON agent_training_programs FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_agent_training_phases ON agent_training_phases FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
