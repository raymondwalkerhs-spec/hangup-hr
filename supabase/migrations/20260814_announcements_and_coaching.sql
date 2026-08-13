-- Company announcements + coaching tickets.
-- Express uses the service role (bypasses RLS). Deny-all for anon/authenticated.

CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL CHECK (company IN ('hangup', 'hs2')),
  title text NOT NULL,
  body_html text NOT NULL DEFAULT '',
  image_path text,
  image_name text,
  audio_path text,
  audio_name text,
  created_by text NOT NULL DEFAULT '',
  updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_company_created
  ON announcements (company, created_at DESC);

CREATE TABLE IF NOT EXISTS coaching_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL CHECK (company IN ('hangup', 'hs2')),
  employee_id text NOT NULL,
  coaching_date date NOT NULL DEFAULT CURRENT_DATE,
  general_notes text NOT NULL DEFAULT '',
  secret_notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_by text NOT NULL DEFAULT '',
  author_employee_id text,
  author_role text NOT NULL DEFAULT '',
  unit text,
  team text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coaching_tickets_company_date
  ON coaching_tickets (company, coaching_date DESC);
CREATE INDEX IF NOT EXISTS idx_coaching_tickets_employee
  ON coaching_tickets (employee_id);
CREATE INDEX IF NOT EXISTS idx_coaching_tickets_created_by
  ON coaching_tickets (created_by);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon ON announcements;
CREATE POLICY deny_anon ON announcements FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_authenticated ON announcements;
CREATE POLICY deny_authenticated ON announcements FOR ALL TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_anon ON coaching_tickets;
CREATE POLICY deny_anon ON coaching_tickets FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_authenticated ON coaching_tickets;
CREATE POLICY deny_authenticated ON coaching_tickets FOR ALL TO authenticated USING (false) WITH CHECK (false);
