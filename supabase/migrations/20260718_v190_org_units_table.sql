-- v1.9.0 — Separate org units into their own table for true multi-company isolation
-- Units are no longer hardcoded strings; they are first-class records with company scoping.

CREATE TABLE IF NOT EXISTS org_units (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text    NOT NULL UNIQUE,
  company_slug  text    NOT NULL REFERENCES companies(slug),
  display_order integer DEFAULT 0,
  has_op        boolean DEFAULT true,
  label         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_units_company ON org_units(company_slug);

-- Seed default units
INSERT INTO org_units (name, company_slug, display_order, has_op, label)
VALUES
  ('HS-1',        'hangup', 1, true, 'Hang-Up (HS-1)'),
  ('HS-3',        'hangup', 2, true, 'Hang-Up (HS-3)'),
  ('HS-Back-End', 'hangup', 3, false, 'Back-End'),
  ('HS-MGMT',     'hangup', 4, false, 'Management'),
  ('HS-2',        'hs2',    1, true, 'HS-2 Company')
ON CONFLICT (name) DO NOTHING;

-- Backfill org_unit_managers for any unit that doesn't have a row yet
INSERT INTO org_unit_managers (unit, company, notes)
SELECT o.name, o.company_slug, 'Auto-seeded from org_units'
FROM org_units o
LEFT JOIN org_unit_managers m ON m.unit = o.name
WHERE m.unit IS NULL
ON CONFLICT (unit) DO NOTHING;

ALTER TABLE org_units ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY deny_all_org_units ON org_units FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
