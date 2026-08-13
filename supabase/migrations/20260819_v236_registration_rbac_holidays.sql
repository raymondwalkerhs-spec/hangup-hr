-- v2.3.15: Opaque org registration codes, per-company holiday activation

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS registration_org_code text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_registration_org_code
  ON companies(registration_org_code)
  WHERE registration_org_code IS NOT NULL;

-- Opaque 4-char codes (not derived from company name)
UPDATE companies SET registration_org_code = 'K7H2'
  WHERE slug = 'hangup' AND (registration_org_code IS NULL OR registration_org_code = '');
UPDATE companies SET registration_org_code = 'M9X4'
  WHERE slug = 'hs2' AND (registration_org_code IS NULL OR registration_org_code = '');

-- Per-company holiday activation (calendar dates remain global)
CREATE TABLE IF NOT EXISTS public_holiday_company_active (
  holiday_id uuid NOT NULL REFERENCES public_holidays(id) ON DELETE CASCADE,
  company text NOT NULL DEFAULT 'hangup',
  active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (holiday_id, company)
);

CREATE INDEX IF NOT EXISTS idx_holiday_company_active_company
  ON public_holiday_company_active(company);

-- Backfill activation from legacy global active flag for both companies
INSERT INTO public_holiday_company_active (holiday_id, company, active)
SELECT h.id, 'hangup', COALESCE(h.active, true)
FROM public_holidays h
ON CONFLICT (holiday_id, company) DO NOTHING;

INSERT INTO public_holiday_company_active (holiday_id, company, active)
SELECT h.id, 'hs2', COALESCE(h.active, true)
FROM public_holidays h
ON CONFLICT (holiday_id, company) DO NOTHING;

ALTER TABLE public_holiday_company_active ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY deny_all_holiday_company_active ON public_holiday_company_active
    FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
