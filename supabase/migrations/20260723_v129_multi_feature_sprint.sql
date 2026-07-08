-- v1.29 Multi-feature sprint
-- Covers: IT ticket routing/approve/deny/reassign, half-day/quarter-day leave,
--         price_tier on quality ticket, meeting participant enhancements,
--         companies table for dynamic multi-company support

-- ============================================================
-- 1. IT Requests — routing workflow columns
-- ============================================================
ALTER TABLE it_requests
  ADD COLUMN IF NOT EXISTS approved_by    text,
  ADD COLUMN IF NOT EXISTS denied_by      text,
  ADD COLUMN IF NOT EXISTS reassigned_by  text,
  ADD COLUMN IF NOT EXISTS reassigned_at  timestamptz,
  ADD COLUMN IF NOT EXISTS denied_at      timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at    timestamptz,
  ADD COLUMN IF NOT EXISTS denial_reason  text,
  ADD COLUMN IF NOT EXISTS unit           text;

CREATE INDEX IF NOT EXISTS idx_it_requests_unit ON it_requests(unit);

-- ============================================================
-- 2. Leave Requests — half-day / quarter-day support
-- ============================================================
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS day_fraction   numeric(4,2) DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS half_day       boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS half_day_part  text         CHECK (half_day_part IN ('morning','afternoon') OR half_day_part IS NULL);

-- ============================================================
-- 3. Sales — price_tier column on quality view
--    Store denormalized price label alongside numeric price
--    so quality ticket can show the tier name (not just number).
-- ============================================================
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS price_tier_label text;

-- Backfill: for catalog-linked sales, fetch label from prices table
-- (safe to run multiple times; only updates where label is missing)
UPDATE sales s
SET price_tier_label = scp.label
FROM sales_client_product_prices scp
WHERE scp.id = (s.form_data->>'salesPriceId')
  AND s.price_tier_label IS NULL
  AND s.form_data->>'salesPriceId' IS NOT NULL;

-- ============================================================
-- 4. Companies table — dynamic multi-company registry
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text    NOT NULL UNIQUE,  -- internal key e.g. 'hangup', 'hs2'
  name            text    NOT NULL,         -- display name e.g. 'Hang-Up', 'HS-2 Company'
  short_name      text,                     -- optional short label for sidebar
  is_default      boolean DEFAULT false,    -- exactly one row is the default company
  active          boolean DEFAULT true,
  sort_order      integer DEFAULT 0,
  color           text,                     -- optional brand color hex
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  created_by      text
);

CREATE INDEX IF NOT EXISTS idx_companies_slug   ON companies(slug);
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(active);

-- Seed default companies (HS1+HS3 merged → Hang-Up; HS2 stays separate)
INSERT INTO companies (slug, name, short_name, is_default, active, sort_order)
VALUES
  ('hangup', 'Hang-Up',     'Hang-Up', true,  true, 1),
  ('hs2',    'HS-2 Company','HS-2',    false, true, 2)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- 5. Per-company access control overrides
--    Extends app_role_permissions with a company scope.
--    NULL company_slug = global (existing behavior).
-- ============================================================
CREATE TABLE IF NOT EXISTS company_role_permissions (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  company_slug   text    NOT NULL REFERENCES companies(slug) ON DELETE CASCADE,
  role           text    NOT NULL,
  permission_key text    NOT NULL,
  allowed        boolean NOT NULL,
  updated_at     timestamptz DEFAULT now(),
  updated_by     text,
  UNIQUE(company_slug, role, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_company_role_perms_company ON company_role_permissions(company_slug);
CREATE INDEX IF NOT EXISTS idx_company_role_perms_role    ON company_role_permissions(company_slug, role);

-- ============================================================
-- 6. Link units to companies
-- ============================================================
ALTER TABLE org_unit_managers
  ADD COLUMN IF NOT EXISTS company_slug text REFERENCES companies(slug);

-- Backfill existing rows
UPDATE org_unit_managers SET company_slug = 'hs2'    WHERE unit = 'HS-2'  AND company_slug IS NULL;
UPDATE org_unit_managers SET company_slug = 'hangup' WHERE unit != 'HS-2' AND company_slug IS NULL;

-- ============================================================
-- 7. Notification routing rules for new IT actions
--    (adds missing defaults if not already present from v128)
-- ============================================================
INSERT INTO notification_routing_rules (action_key, label, description, recipient_roles, recipient_usernames)
VALUES
  ('it_request_submitted',  'IT request submitted',  'New IT request created by employee',         '{it,admin,ceo}',     '{}'),
  ('it_request_assigned',   'IT request assigned',   'IT request assigned to a staff member',       '{it,admin,ceo}',     '{}'),
  ('it_request_approved',   'IT request approved',   'IT request marked as approved/in-progress',   '{it,admin,ceo,hr}',  '{}'),
  ('it_request_denied',     'IT request denied',     'IT request denied with reason',               '{it,admin,ceo,hr}',  '{}'),
  ('it_request_reassigned', 'IT request reassigned', 'IT request reassigned to another IT member',  '{it,admin,ceo}',     '{}'),
  ('it_request_resolved',   'IT request resolved',   'IT request marked resolved or closed',        '{it,admin,ceo,hr}',  '{}'),
  ('meeting_request_submitted', 'Meeting request submitted', 'New meeting request created',         '{admin,ceo,hr}',     '{}'),
  ('meeting_request_reviewed',  'Meeting request reviewed',  'Meeting request approved/rejected',   '{admin,ceo,hr}',     '{}')
ON CONFLICT (action_key) DO NOTHING;

-- ============================================================
-- 8. RLS deny-all on new tables
-- ============================================================
ALTER TABLE companies                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_role_permissions   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY deny_all_companies ON companies
    FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY deny_all_company_role_permissions ON company_role_permissions
    FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
