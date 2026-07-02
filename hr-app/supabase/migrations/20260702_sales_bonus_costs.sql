-- Sales, bonus approval, costs, and persistent notifications

CREATE TABLE IF NOT EXISTS bonus_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  date date NOT NULL,
  type text NOT NULL DEFAULT 'Other Bonus',
  reason text,
  unit text,
  status text NOT NULL DEFAULT 'pending',
  submitted_by text NOT NULL,
  reviewed_by text,
  reviewed_at timestamptz,
  deny_reason text,
  bonus_employee_id text,
  bonus_date date,
  bonus_type text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bonus_requests_status ON bonus_requests(status);
CREATE INDEX IF NOT EXISTS idx_bonus_requests_date ON bonus_requests(date);
CREATE INDEX IF NOT EXISTS idx_bonus_requests_employee ON bonus_requests(employee_id);

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  full_name text NOT NULL,
  device text NOT NULL CHECK (device IN ('bracelet', 'necklace', 'smartwatch')),
  price numeric,
  client text,
  agent_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  closer_id text REFERENCES employees(id) ON DELETE SET NULL,
  submitted_by text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('passed', 'pending', 'postdated', 'denied', 'callback')),
  submission_date date NOT NULL DEFAULT CURRENT_DATE,
  effective_date date NOT NULL,
  feedback text,
  callback_visible_to_agent boolean DEFAULT false,
  team text,
  unit text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_agent ON sales(agent_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_effective ON sales(effective_date);
CREATE INDEX IF NOT EXISTS idx_sales_team ON sales(team);
CREATE INDEX IF NOT EXISTS idx_sales_unit ON sales(unit);

CREATE TABLE IF NOT EXISTS sales_visibility_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  granter_username text NOT NULL,
  grantee_username text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('team', 'unit', 'company')),
  scope_value text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(granter_username, grantee_username, scope_type, scope_value)
);
CREATE INDEX IF NOT EXISTS idx_sales_grants_grantee ON sales_visibility_grants(grantee_username);

CREATE TABLE IF NOT EXISTS petty_cash_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_name text NOT NULL UNIQUE,
  balance numeric NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO petty_cash_funds (fund_name, balance) VALUES ('Main petty cash', 0)
ON CONFLICT (fund_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS petty_cash_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES petty_cash_funds(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal', 'adjustment')),
  amount numeric NOT NULL,
  balance_after numeric NOT NULL,
  linked_expense_id uuid,
  notes text,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_fund ON petty_cash_ledger(fund_id);

CREATE TABLE IF NOT EXISTS expense_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name text NOT NULL,
  description text,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
    'paid', 'pending', 'on_hold', 'pending_approval', 'denied', 'archived'
  )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'emergency')),
  starred boolean DEFAULT false,
  due_date date,
  payment_method text CHECK (payment_method IN ('instapay', 'cash', 'wallet', 'petty_cash', 'own_pocket')),
  paid_by text,
  petty_cash_fund_id uuid REFERENCES petty_cash_funds(id),
  settlement_status text CHECK (settlement_status IN ('awaiting_settlement', 'settled')),
  settlement_method text,
  receipt_file_id text,
  cash_receipt_number text,
  requires_executive_approval boolean DEFAULT false,
  submitted_by text NOT NULL,
  approved_by text,
  archived_by text,
  archived_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_status ON expense_requests(status);
CREATE INDEX IF NOT EXISTS idx_expense_submitter ON expense_requests(submitted_by);
CREATE INDEX IF NOT EXISTS idx_expense_due ON expense_requests(due_date);

CREATE TABLE IF NOT EXISTS monthly_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_type text NOT NULL CHECK (bill_type IN (
    'landline', 'internet', 'cellphone', 'electricity', 'water', 'maintenance', 'other'
  )),
  vendor text NOT NULL,
  amount numeric,
  due_day_of_month integer CHECK (due_day_of_month BETWEEN 1 AND 31),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'pending', 'on_hold')),
  starred boolean DEFAULT false,
  notes text,
  last_paid_at timestamptz,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_notifications_user ON app_notifications(username);
CREATE INDEX IF NOT EXISTS idx_app_notifications_unread ON app_notifications(username, read_at);

-- RLS (deny-all pattern — service role bypasses)
ALTER TABLE bonus_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_visibility_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY deny_all_bonus_requests ON bonus_requests FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_sales ON sales FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_sales_grants ON sales_visibility_grants FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_petty_funds ON petty_cash_funds FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_petty_ledger ON petty_cash_ledger FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_expenses ON expense_requests FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_monthly_bills ON monthly_bills FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY deny_all_app_notifications ON app_notifications FOR ALL TO anon, authenticated USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
