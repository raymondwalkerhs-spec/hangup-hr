-- Federal holidays: per-row active flag (excluded from attendance prefill when false)
ALTER TABLE public_holidays
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

UPDATE public_holidays SET active = true WHERE active IS NULL;
