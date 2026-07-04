-- Notification routing rules + employee quality notes

CREATE TABLE IF NOT EXISTS notification_routing_rules (
  action_key text PRIMARY KEY,
  label text NOT NULL,
  description text DEFAULT '',
  recipient_roles text[] NOT NULL DEFAULT '{}',
  recipient_usernames text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employee_quality_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  author_username text NOT NULL,
  author_role text DEFAULT '',
  body text NOT NULL DEFAULT '',
  note_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_notes_employee ON employee_quality_notes(employee_id);
CREATE INDEX IF NOT EXISTS idx_quality_notes_created ON employee_quality_notes(created_at DESC);

ALTER TABLE notification_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_quality_notes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY deny_all_notification_routing ON notification_routing_rules FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY deny_all_quality_notes ON employee_quality_notes FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
