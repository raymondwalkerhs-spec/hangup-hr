-- Office PO catalog, month meta (headcount + days-in-scope), lines, purchases

CREATE TABLE IF NOT EXISTS public.office_po_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL DEFAULT 'hangup',
  name text NOT NULL,
  category text,
  unit text,
  scale_mode text NOT NULL DEFAULT 'employee'
    CHECK (scale_mode IN ('employee', 'office_fixed')),
  per_employees numeric,
  pack_qty numeric,
  office_qty numeric,
  ignore_days_scale boolean NOT NULL DEFAULT false,
  cadence text NOT NULL DEFAULT 'monthly'
    CHECK (cadence IN ('monthly', 'every_n_months', 'one_time')),
  every_n_months int,
  anchor_year_month text,
  unit_price numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_office_po_items_company_active
  ON public.office_po_items (company, active);
CREATE INDEX IF NOT EXISTS idx_office_po_items_company_category
  ON public.office_po_items (company, category);

CREATE TABLE IF NOT EXISTS public.office_po_month_meta (
  company text NOT NULL,
  year_month text NOT NULL,
  avg_employees_override numeric,
  days_in_scope_override numeric,
  days_in_scope_note text,
  override_note text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company, year_month),
  CONSTRAINT office_po_month_meta_ym_chk CHECK (year_month ~ '^\d{4}-\d{2}$')
);

CREATE TABLE IF NOT EXISTS public.office_po_month_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL,
  year_month text NOT NULL,
  item_id uuid NOT NULL REFERENCES public.office_po_items(id),
  status text NOT NULL DEFAULT 'predicted'
    CHECK (status IN ('predicted', 'bought', 'postponed', 'cancelled')),
  predicted_qty numeric NOT NULL DEFAULT 0,
  predicted_cost numeric,
  actual_qty numeric NOT NULL DEFAULT 0,
  actual_cost numeric NOT NULL DEFAULT 0,
  avg_employees_used numeric,
  days_in_scope_used numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT office_po_month_lines_ym_chk CHECK (year_month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT office_po_month_lines_uniq UNIQUE (company, year_month, item_id)
);

CREATE INDEX IF NOT EXISTS idx_office_po_lines_company_ym
  ON public.office_po_month_lines (company, year_month);
CREATE INDEX IF NOT EXISTS idx_office_po_lines_item
  ON public.office_po_month_lines (item_id);
CREATE INDEX IF NOT EXISTS idx_office_po_lines_status
  ON public.office_po_month_lines (status);

CREATE TABLE IF NOT EXISTS public.office_po_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_line_id uuid NOT NULL REFERENCES public.office_po_month_lines(id) ON DELETE CASCADE,
  company text NOT NULL,
  qty numeric NOT NULL,
  unit_price numeric,
  order_ref text,
  bought_at timestamptz NOT NULL DEFAULT now(),
  bought_by text,
  note text
);

CREATE INDEX IF NOT EXISTS idx_office_po_purchases_line
  ON public.office_po_purchases (month_line_id);

ALTER TABLE public.office_po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_po_month_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_po_month_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_po_purchases ENABLE ROW LEVEL SECURITY;
