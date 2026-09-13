-- Loan repayment schedule lines (v2): explicit per-month plan with skip/defer.
-- Dual-read with legacy installment counters until backfill completes.
-- Service role only (RLS deny-all for anon/authenticated).

CREATE TABLE IF NOT EXISTS public.loan_schedule_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id text NOT NULL REFERENCES public.employee_loans(id) ON DELETE CASCADE,
  seq int NOT NULL,
  year_month text NOT NULL,
  due_amount numeric NOT NULL CHECK (due_amount >= 0),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN (
      'scheduled', 'skipped', 'due', 'in_payroll', 'paid', 'waived', 'cancelled'
    )),
  paid_amount numeric,
  paid_at timestamptz,
  skip_reason text DEFAULT '',
  deferred_from_line_id uuid REFERENCES public.loan_schedule_lines(id) ON DELETE SET NULL,
  deferred_to_line_id uuid REFERENCES public.loan_schedule_lines(id) ON DELETE SET NULL,
  locked boolean NOT NULL DEFAULT false,
  unit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loan_schedule_lines_ym_chk CHECK (year_month ~ '^\d{4}-\d{2}$')
);

-- One active (non-cancelled) line per loan/month
CREATE UNIQUE INDEX IF NOT EXISTS loan_schedule_lines_loan_ym_active_uq
  ON public.loan_schedule_lines (loan_id, year_month)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_loan_schedule_lines_loan ON public.loan_schedule_lines(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_schedule_lines_ym ON public.loan_schedule_lines(year_month);
CREATE INDEX IF NOT EXISTS idx_loan_schedule_lines_status ON public.loan_schedule_lines(status);

ALTER TABLE public.employee_loans
  ADD COLUMN IF NOT EXISTS disbursement_date date,
  ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;

ALTER TABLE public.loan_payments
  ADD COLUMN IF NOT EXISTS schedule_line_id uuid
    REFERENCES public.loan_schedule_lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_loan_payments_schedule_line
  ON public.loan_payments(schedule_line_id)
  WHERE schedule_line_id IS NOT NULL;

ALTER TABLE public.loan_schedule_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all_loan_schedule_lines ON public.loan_schedule_lines;
CREATE POLICY deny_all_loan_schedule_lines ON public.loan_schedule_lines
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.loan_schedule_lines IS
  'Per-month loan repayment schedule with skip/defer; payroll dual-reads until legacy loans are backfilled.';
COMMENT ON COLUMN public.employee_loans.disbursement_date IS
  'Optional date funds were disbursed (informational).';
COMMENT ON COLUMN public.employee_loans.paused IS
  'When true, no salary deduction is taken until unpaused.';
COMMENT ON COLUMN public.loan_payments.schedule_line_id IS
  'Optional link to the schedule line that was settled by this payment.';
