-- Allow USA + Egypt holidays on the same calendar date; Egypt defaults inactive at seed time.
ALTER TABLE public_holidays DROP CONSTRAINT IF EXISTS public_holidays_holiday_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_holidays_date_country
  ON public_holidays (holiday_date, country);
