-- DB-only compensation until training quarter-day app fix ships.
-- Old training rule: Quarter Day-Off = 0.25 pay units (0.75 day lost).
-- Desired: only 0.25 day lost → compensate with payroll_adjustments.extra_days = +0.5
--   (effective units 0.25 + 0.5 = 0.75).
--
-- On ship of app fix (trainingPayUnitForRecord unpaid quarter → 0.75):
--   CLEAR these extra_days or pay will be double-corrected.
--   See plan: office-po-prediction_3f099f59.plan.md § "Ship gate — training quarter extra_days".

-- HS3-81 emily adams — 2026-08-28 unpaid Quarter Day-Off while in training
UPDATE public.payroll_adjustments
SET
  extra_days = 0.5,
  month_notes = 'HR-approved quarter day 2026-08-28: training pay counted 0.25 units (0.75 deducted). Temporary extra_days=0.5 so only 0.25 is deducted. CLEAR this when app ships training quarter→0.75 units.',
  updated_by = 'system-quarter-day-fix',
  updated_at = now()
WHERE employee_id = 'HS3-81'
  AND year_month = '2026-08';

-- HS3-27 Daniel Mathew — 2026-06-23 unpaid Quarter Day-Off while in training
UPDATE public.payroll_adjustments
SET
  extra_days = 0.5,
  month_notes = CASE
    WHEN coalesce(month_notes, '') = ''
      OR month_notes ILIKE '%Training unpaid Quarter Day-Off 2026-06-23%'
      OR month_notes ILIKE '%migration-training-quarter%'
    THEN 'Training unpaid Quarter Day-Off 2026-06-23: temporary extra_days=0.5 (old rule paid 0.25 units). CLEAR when app ships training quarter→0.75 units.'
    ELSE month_notes || E'\n' ||
      'Training unpaid Quarter Day-Off 2026-06-23: temporary extra_days=0.5 (old rule paid 0.25 units). CLEAR when app ships training quarter→0.75 units.'
  END,
  updated_by = 'system-quarter-day-fix',
  updated_at = now()
WHERE employee_id = 'HS3-27'
  AND year_month = '2026-06';

UPDATE public.attendance_events
SET
  leave_note = 'same_day leave (quarter day) — HR approved; payroll corrected via extra_days 0.5 (clear on app ship)',
  updated_by = 'system-quarter-day-fix',
  updated_at = now()
WHERE (employee_id, date) IN (
  ('HS3-81', '2026-08-28'::date),
  ('HS3-27', '2026-06-23'::date)
)
AND status = 'Quarter Day-Off';
