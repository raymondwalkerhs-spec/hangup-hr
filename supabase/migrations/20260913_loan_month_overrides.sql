-- Per-month loan deduction overrides (extra or reduced salary deduction).
-- Remaining balance is tracked from sum(loan_payments.amount), not installment counters alone.

CREATE TABLE IF NOT EXISTS public.loan_month_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id text NOT NULL REFERENCES public.employee_loans(id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  year_month text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  note text DEFAULT '',
  unit text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loan_month_overrides_ym_chk CHECK (year_month ~ '^\d{4}-\d{2}$'),
  CONSTRAINT loan_month_overrides_loan_ym_uq UNIQUE (loan_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_loan_month_overrides_loan ON public.loan_month_overrides(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_month_overrides_ym ON public.loan_month_overrides(year_month);
CREATE INDEX IF NOT EXISTS idx_loan_month_overrides_emp ON public.loan_month_overrides(employee_id);

ALTER TABLE public.loan_month_overrides ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.loan_month_overrides IS
  'Planned salary deduction amount for a loan in a given YYYY-MM (may be higher or lower than default installment).';
