-- v2.2.0: Optional one-time backfill — align interview_feedbacks.company with candidate row
UPDATE interview_feedbacks f
SET company = c.company
FROM candidate_applications c
WHERE f.candidate_id = c.id
  AND f.company IS DISTINCT FROM c.company;
