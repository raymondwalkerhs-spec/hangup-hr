-- Cost funding source: petty_cash | main_fund (plus legacy methods)
-- Ensure payment_method can store main_fund; normalize historical rows as paid petty-cash.

ALTER TABLE expense_requests
  DROP CONSTRAINT IF EXISTS expense_requests_payment_method_check;

-- Soft constraint via app; keep DB permissive for legacy instapay/cash/wallet/own_pocket
COMMENT ON COLUMN expense_requests.payment_method IS
  'Funding/payment source: petty_cash | main_fund | instapay | cash | wallet | own_pocket';

-- Historical cleanup is done by scripts/assign-costs-petty-cash.js (idempotent)
;