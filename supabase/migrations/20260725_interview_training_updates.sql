-- Interview and Training module updates
-- Adds company exclusion for HS2, renames status fields, adds training batch support

-- ============================================================
-- 1. candidate_applications updates
-- ============================================================

-- First, normalize existing status values to lowercase
UPDATE candidate_applications
SET status = lower(status)
WHERE status IS NOT NULL;

-- Rename status to first_interview_status
ALTER TABLE candidate_applications
  RENAME COLUMN status TO first_interview_status;

-- Rename feedback to first_interview_feedback
ALTER TABLE candidate_applications
  RENAME COLUMN feedback TO first_interview_feedback;

-- Update status constraints
ALTER TABLE candidate_applications
  DROP CONSTRAINT IF EXISTS candidate_applications_first_interview_status_check;

ALTER TABLE candidate_applications
  ADD CONSTRAINT candidate_applications_first_interview_status_check
  CHECK (first_interview_status IN ('pending', 'on hold', 'accepted', 'rejected'));

-- Update training_status constraint
ALTER TABLE candidate_applications
  DROP CONSTRAINT IF EXISTS candidate_applications_training_status_check;

ALTER TABLE candidate_applications
  ADD CONSTRAINT candidate_applications_training_status_check
  CHECK (training_status IN ('waiting', 'started', 'no show no call', 'dropped', 'postponed') OR training_status IS NULL);

-- Add batch_number for training batches
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS batch_number text;

CREATE INDEX IF NOT EXISTS idx_candidate_applications_batch_number ON candidate_applications(batch_number);

-- Add company column to track main company vs HS2
ALTER TABLE candidate_applications
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

CREATE INDEX IF NOT EXISTS idx_candidate_applications_company ON candidate_applications(company);

-- Update second_interview_status constraint
ALTER TABLE candidate_applications
  DROP CONSTRAINT IF EXISTS candidate_applications_second_interview_status_check;

ALTER TABLE candidate_applications
  ADD CONSTRAINT candidate_applications_second_interview_status_check
  CHECK (second_interview_status IN ('pending', 'on hold', 'accepted', 'rejected') OR second_interview_status IS NULL);

-- ============================================================
-- 2. training_feedbacks table updates
-- ============================================================

-- Add test_call_day flag and metrics columns
ALTER TABLE interview_feedbacks
  ADD COLUMN IF NOT EXISTS is_test_call_day boolean DEFAULT false;

ALTER TABLE interview_feedbacks
  ADD COLUMN IF NOT EXISTS active_listening_metric integer CHECK (active_listening_metric BETWEEN 1 AND 5);

ALTER TABLE interview_feedbacks
  ADD COLUMN IF NOT EXISTS english_metric integer CHECK (english_metric BETWEEN 1 AND 5);

ALTER TABLE interview_feedbacks
  ADD COLUMN IF NOT EXISTS accent_metric integer CHECK (accent_metric BETWEEN 1 AND 5);

ALTER TABLE interview_feedbacks
  ADD COLUMN IF NOT EXISTS product_knowledge_metric integer CHECK (product_knowledge_metric BETWEEN 1 AND 5);

-- Add company column to training_feedbacks for HS2 exclusion
ALTER TABLE interview_feedbacks
  ADD COLUMN IF NOT EXISTS company text DEFAULT 'hangup';

CREATE INDEX IF NOT EXISTS idx_interview_feedbacks_company ON interview_feedbacks(company);

-- ============================================================
-- 3. RLS policies update
-- ============================================================

-- Drop old policies
DROP POLICY IF EXISTS "Allow service role full access candidate_applications" ON candidate_applications;
DROP POLICY IF EXISTS "Allow service role full access interview_feedbacks" ON interview_feedbacks;

-- Recreate with company awareness
CREATE POLICY "Allow service role full access candidate_applications"
  ON candidate_applications FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Allow service role full access interview_feedbacks"
  ON interview_feedbacks FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 4. Update triggers
-- ============================================================

DROP TRIGGER IF EXISTS trg_candidate_applications_updated_at ON candidate_applications;
CREATE TRIGGER trg_candidate_applications_updated_at
  BEFORE UPDATE ON candidate_applications
  FOR EACH ROW EXECUTE FUNCTION update_candidate_updated_at();

DROP TRIGGER IF EXISTS trg_interview_feedbacks_updated_at ON interview_feedbacks;
CREATE TRIGGER trg_interview_feedbacks_updated_at
  BEFORE UPDATE ON interview_feedbacks
  FOR EACH ROW EXECUTE FUNCTION update_candidate_updated_at();
