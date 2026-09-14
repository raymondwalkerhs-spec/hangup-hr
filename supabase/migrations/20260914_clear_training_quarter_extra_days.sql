-- Supersedes 20260913_clear_training_quarter_extra_days.sql for greenfield ordering.
-- Must run AFTER this: 20260913_training_quarter_day_pay_fix.sql
-- Must run AFTER app ships Quarter Day-Off = 0.75 (lib/training-pay-rules.js).

UPDATE payroll_adjustments
SET
  extra_days = 0,
  month_notes = CASE
    WHEN employee_id = 'HS3-81' AND year_month = '2026-08' THEN
      trim(both from coalesce(month_notes, '') || ' | Cleared system-quarter-day-fix extra_days=0.5 — app now pays Quarter Day-Off as 0.75.')
    WHEN employee_id = 'HS3-27' AND year_month = '2026-06' THEN
      trim(both from coalesce(month_notes, '') || ' | Cleared system-quarter-day-fix extra_days=0.5 — app now pays Quarter Day-Off as 0.75.')
    ELSE month_notes
  END,
  updated_by = 'system-quarter-day-clear',
  updated_at = now()
WHERE (
    updated_by = 'system-quarter-day-fix'
    OR (
      employee_id IN ('HS3-81', 'HS3-27')
      AND year_month IN ('2026-08', '2026-06')
      AND coalesce(extra_days, 0) = 0.5
    )
  )
  AND (
    (employee_id = 'HS3-81' AND year_month = '2026-08')
    OR (employee_id = 'HS3-27' AND year_month = '2026-06')
  )
  AND coalesce(extra_days, 0) = 0.5;
