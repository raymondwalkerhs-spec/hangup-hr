-- v1.2.0: sales clients/products, break schedules, settings revision

CREATE TABLE IF NOT EXISTS app_settings_revision (
  key text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO app_settings_revision (key, revision) VALUES ('global', 1)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'hold', 'warn')),
  status_message text DEFAULT '',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_clients_name_lower ON sales_clients (lower(trim(name)));

CREATE TABLE IF NOT EXISTS sales_client_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES sales_clients(id) ON DELETE CASCADE,
  device_type text NOT NULL CHECK (device_type IN ('smartwatch', 'bracelet', 'necklace')),
  label text NOT NULL DEFAULT '',
  is_favored boolean DEFAULT false,
  priority_note text DEFAULT '',
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_client_products_client ON sales_client_products(client_id);

CREATE TABLE IF NOT EXISTS sales_client_product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES sales_client_products(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Standard',
  price numeric NOT NULL DEFAULT 0,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_client_prices_product ON sales_client_product_prices(product_id);

CREATE TABLE IF NOT EXISTS break_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 15,
  message text DEFAULT '',
  active boolean DEFAULT true,
  units text[] NOT NULL DEFAULT ARRAY[]::text[],
  roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  days_of_week integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7],
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE sales_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_client_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_client_product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings_revision ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales_clients' AND policyname = 'deny_all_sales_clients') THEN
    CREATE POLICY deny_all_sales_clients ON sales_clients FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales_client_products' AND policyname = 'deny_all_sales_client_products') THEN
    CREATE POLICY deny_all_sales_client_products ON sales_client_products FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales_client_product_prices' AND policyname = 'deny_all_sales_client_prices') THEN
    CREATE POLICY deny_all_sales_client_prices ON sales_client_product_prices FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'break_schedules' AND policyname = 'deny_all_break_schedules') THEN
    CREATE POLICY deny_all_break_schedules ON break_schedules FOR ALL TO anon, authenticated USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_settings_revision' AND policyname = 'deny_all_app_settings_revision') THEN
    CREATE POLICY deny_all_app_settings_revision ON app_settings_revision FOR ALL TO anon, authenticated USING (false);
  END IF;
END $$;
