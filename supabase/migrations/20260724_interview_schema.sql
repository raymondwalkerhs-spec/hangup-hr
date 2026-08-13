-- Interview module: Supabase primary source of truth
-- Replaces Google Form-driven workflow with Supabase + Google Sheets sync

-- ============================================================
-- 1. candidate_applications
-- ============================================================
CREATE TABLE IF NOT EXISTS candidate_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  submitted_by text,
  status text DEFAULT 'Pending',
  feedback text,
  interview_date date,
  interviewer text,
  training_status text,
  training_start_date date,
  trainer text,
  second_interview_date date,
  second_interview_feedback text,
  second_interview_status text,
  second_interviewer text,
  -- Form fields
  timestamp text,
  name text,
  email text,
  phone text,
  whatsapp text,
  date_of_birth text,
  address text,
  graduation_status text,
  faculty_name text,
  university_name text,
  national_id text,
  previous_experiences text,
  gender text,
  english_speaking text,
  english_writing text,
  english_listening text,
  fast_paced_rating text,
  available_days text,
  currently_employed text,
  preferred_working_mode text,
  how_heard text,
  company_if_yes text
);

CREATE INDEX IF NOT EXISTS idx_candidate_applications_status ON candidate_applications(status);
CREATE INDEX IF NOT EXISTS idx_candidate_applications_trainer ON candidate_applications(trainer);
CREATE INDEX IF NOT EXISTS idx_candidate_applications_created_at ON candidate_applications(created_at);

-- ============================================================
-- 2. interview_feedbacks
-- ============================================================
CREATE TABLE IF NOT EXISTS interview_feedbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  candidate_id uuid REFERENCES candidate_applications(id) ON DELETE CASCADE,
  candidate_name text NOT NULL,
  candidate_email text,
  day integer NOT NULL CHECK (day BETWEEN 1 AND 5),
  feedback_text text NOT NULL DEFAULT '',
  trainer text NOT NULL,
  date date
);

CREATE INDEX IF NOT EXISTS idx_interview_feedbacks_candidate ON interview_feedbacks(candidate_id);
CREATE INDEX IF NOT EXISTS idx_interview_feedbacks_trainer ON interview_feedbacks(trainer);
CREATE INDEX IF NOT EXISTS idx_interview_feedbacks_day ON interview_feedbacks(candidate_id, day);

-- ============================================================
-- 3. RLS policies (allow authenticated app access)
-- ============================================================
ALTER TABLE candidate_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_feedbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access candidate_applications"
  ON candidate_applications FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Allow service role full access interview_feedbacks"
  ON interview_feedbacks FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 4. Triggers for updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_candidate_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_candidate_applications_updated_at ON candidate_applications;
CREATE TRIGGER trg_candidate_applications_updated_at
  BEFORE UPDATE ON candidate_applications
  FOR EACH ROW EXECUTE FUNCTION update_candidate_updated_at();

DROP TRIGGER IF EXISTS trg_interview_feedbacks_updated_at ON interview_feedbacks;
CREATE TRIGGER trg_interview_feedbacks_updated_at
  BEFORE UPDATE ON interview_feedbacks
  FOR EACH ROW EXECUTE FUNCTION update_candidate_updated_at();
