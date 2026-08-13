-- Announcement audience targeting + image placement.

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS audience_units text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience_teams text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience_roles text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS image_placement text NOT NULL DEFAULT 'top';

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_image_placement_check;
ALTER TABLE announcements
  ADD CONSTRAINT announcements_image_placement_check
  CHECK (image_placement IN ('top', 'middle', 'bottom'));
