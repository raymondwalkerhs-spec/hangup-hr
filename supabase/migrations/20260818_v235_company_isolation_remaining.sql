-- v2.3.15: Per-company isolation for payroll locks, commission tiers, notifications, loans

-- payroll_month_locks: one lock per company per month
ALTER TABLE payroll_month_locks ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT 'hangup';
UPDATE payroll_month_locks SET company = 'hangup' WHERE company IS NULL OR company = '';

DO $$ BEGIN
  ALTER TABLE payroll_month_locks DROP CONSTRAINT payroll_month_locks_pkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE payroll_month_locks ADD PRIMARY KEY (company, year_month);

-- commission_tiers (table may be app-created without migration)
CREATE TABLE IF NOT EXISTS commission_tiers (
  company text NOT NULL DEFAULT 'hangup',
  year_month text NOT NULL,
  min_sales integer NOT NULL DEFAULT 0,
  bonus_amount numeric NOT NULL DEFAULT 0,
  label text DEFAULT '',
  PRIMARY KEY (company, year_month, min_sales)
);

ALTER TABLE commission_tiers ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT 'hangup';
UPDATE commission_tiers SET company = 'hangup' WHERE company IS NULL OR company = '';

DO $$ BEGIN
  ALTER TABLE commission_tiers DROP CONSTRAINT commission_tiers_pkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE commission_tiers ADD PRIMARY KEY (company, year_month, min_sales);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- notification_routing_rules: per company
ALTER TABLE notification_routing_rules ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT 'hangup';
UPDATE notification_routing_rules SET company = 'hangup' WHERE company IS NULL OR company = '';

DO $$ BEGIN
  ALTER TABLE notification_routing_rules DROP CONSTRAINT notification_routing_rules_pkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE notification_routing_rules ADD PRIMARY KEY (company, action_key);

INSERT INTO notification_routing_rules (
  company, action_key, label, description, recipient_roles, recipient_usernames, enabled
)
SELECT
  'hs2', action_key, label, description, recipient_roles, recipient_usernames, enabled
FROM notification_routing_rules
WHERE company = 'hangup'
ON CONFLICT (company, action_key) DO NOTHING;

-- persisted in-app notifications
ALTER TABLE app_notifications ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT 'hangup';
CREATE INDEX IF NOT EXISTS idx_app_notifications_company_user ON app_notifications(company, username);

-- loan requests
ALTER TABLE loan_requests ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT 'hangup';
CREATE INDEX IF NOT EXISTS idx_loan_requests_company ON loan_requests(company);

UPDATE loan_requests lr
SET company = CASE
  WHEN EXISTS (
    SELECT 1 FROM employees e
    JOIN org_unit_managers oum ON oum.unit = e.unit AND oum.company = 'hs2'
    WHERE e.id = lr.employee_id
  ) THEN 'hs2'
  ELSE 'hangup'
END
WHERE lr.company IS NULL OR lr.company = 'hangup';

-- position_rates: unique per company + position
CREATE UNIQUE INDEX IF NOT EXISTS idx_position_rates_company_position
  ON position_rates(company, position);
