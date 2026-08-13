-- Coaching ticket rules: coach, submitter, outcome, datetime, extra notes.

ALTER TABLE coaching_tickets
  ADD COLUMN IF NOT EXISTS coach_employee_id text,
  ADD COLUMN IF NOT EXISTS submitted_by text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS coaching_at timestamptz,
  ADD COLUMN IF NOT EXISTS extra_general_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS extra_secret_notes text NOT NULL DEFAULT '';

UPDATE coaching_tickets
SET coaching_at = (coaching_date::timestamp AT TIME ZONE 'Africa/Cairo')
WHERE coaching_at IS NULL AND coaching_date IS NOT NULL;

UPDATE coaching_tickets
SET submitted_by = created_by
WHERE COALESCE(submitted_by, '') = '' AND COALESCE(created_by, '') <> '';

UPDATE coaching_tickets
SET coach_employee_id = author_employee_id
WHERE COALESCE(coach_employee_id, '') = '' AND COALESCE(author_employee_id, '') <> '';

ALTER TABLE coaching_tickets DROP CONSTRAINT IF EXISTS coaching_tickets_outcome_check;
ALTER TABLE coaching_tickets
  ADD CONSTRAINT coaching_tickets_outcome_check
  CHECK (outcome IN ('positive', 'negative', 'pending', 'normal'));

CREATE INDEX IF NOT EXISTS idx_coaching_tickets_coach ON coaching_tickets (coach_employee_id);
CREATE INDEX IF NOT EXISTS idx_coaching_tickets_outcome ON coaching_tickets (outcome);
CREATE INDEX IF NOT EXISTS idx_coaching_tickets_at ON coaching_tickets (coaching_at DESC);
