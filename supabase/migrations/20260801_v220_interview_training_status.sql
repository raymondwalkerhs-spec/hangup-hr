-- v2.2.0: training_status v2 — on hold replaces "no show no call"; add cancelled

UPDATE candidate_applications
SET training_status = 'on hold'
WHERE training_status = 'no show no call';

ALTER TABLE candidate_applications
  DROP CONSTRAINT IF EXISTS candidate_applications_training_status_check;

ALTER TABLE candidate_applications
  ADD CONSTRAINT candidate_applications_training_status_check
  CHECK (
    training_status IN ('waiting', 'on hold', 'started', 'dropped', 'postponed', 'cancelled')
    OR training_status IS NULL
  );
