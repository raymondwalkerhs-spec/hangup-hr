-- Per-user announcement read receipts (sidebar unread badge).

CREATE TABLE IF NOT EXISTS announcement_reads (
  username text NOT NULL,
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (username, announcement_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement
  ON announcement_reads (announcement_id);

ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon ON announcement_reads;
CREATE POLICY deny_anon ON announcement_reads FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS deny_authenticated ON announcement_reads;
CREATE POLICY deny_authenticated ON announcement_reads FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Existing posts should not light up the badge for everyone.
INSERT INTO announcement_reads (username, announcement_id, read_at)
SELECT lower(trim(u.username)), a.id, now()
FROM announcements a
CROSS JOIN app_users u
WHERE coalesce(trim(u.username), '') <> ''
ON CONFLICT (username, announcement_id) DO NOTHING;
