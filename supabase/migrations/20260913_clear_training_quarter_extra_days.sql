-- Part D ship gate: CLEAR temporary extra_days once app pays unpaid training
-- Quarter Day-Off as 0.75 units (lib/training-pay-rules.js). Leaving 0.5 would double-correct.

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
WHERE updated_by = 'system-quarter-day-fix'
  AND (
    (employee_id = 'HS3-81' AND year_month = '2026-08')
    OR (employee_id = 'HS3-27' AND year_month = '2026-06')
  )
  AND coalesce(extra_days, 0) = 0.5;
