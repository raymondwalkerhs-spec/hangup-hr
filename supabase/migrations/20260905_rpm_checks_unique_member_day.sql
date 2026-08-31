-- One live check per company + Member ID (MCN) + working day (any agent).
-- Soft-delete duplicates, backfill sale links, then unique index.
-- Also ensure rpm_sale_duplicate notifies Quality + RTM + Admin.

-- 1) Soft-delete duplicate losers (keep sale-linked / feedback=sale, else earliest)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company, member_id_normalized, working_day
      ORDER BY
        CASE
          WHEN linked_rpm_sale_id IS NOT NULL OR feedback_status = 'sale' THEN 0
          ELSE 1
        END,
        created_at ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM rpm_checks
  WHERE deleted_at IS NULL
    AND member_id_normalized IS NOT NULL
    AND TRIM(member_id_normalized) <> ''
)
UPDATE rpm_checks AS c
SET
  deleted_at = NOW(),
  updated_at = NOW()
FROM ranked AS r
WHERE c.id = r.id
  AND r.rn > 1
  AND c.deleted_at IS NULL;

-- 2) Backfill: link unlinked same-day Q to matching sale (one check per sale)
WITH candidates AS (
  SELECT
    c.id AS check_id,
    s.id AS sale_id,
    s.closer_id AS sale_closer,
    ROW_NUMBER() OVER (
      PARTITION BY s.id
      ORDER BY
        CASE WHEN c.agent_id = s.agent_id THEN 0 ELSE 1 END,
        c.created_at ASC NULLS LAST,
        c.id ASC
    ) AS sale_rn,
    ROW_NUMBER() OVER (
      PARTITION BY c.id
      ORDER BY
        CASE WHEN c.agent_id = s.agent_id THEN 0 ELSE 1 END,
        s.created_at ASC NULLS LAST,
        s.id ASC
    ) AS check_rn
  FROM rpm_checks AS c
  INNER JOIN rpm_sales AS s
    ON NULLIF(TRIM(s.member_id), '') IS NOT NULL
   AND UPPER(REGEXP_REPLACE(s.member_id, '[^A-Za-z0-9]', '', 'g')) = c.member_id_normalized
   AND s.working_day::date = c.working_day::date
  WHERE c.deleted_at IS NULL
    AND c.check_status = 'q'
    AND c.linked_rpm_sale_id IS NULL
    AND c.member_id_normalized IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM rpm_checks AS x
      WHERE x.linked_rpm_sale_id = s.id
        AND x.deleted_at IS NULL
    )
)
UPDATE rpm_checks AS c
SET
  linked_rpm_sale_id = cand.sale_id,
  feedback_status = 'sale',
  closer_id = COALESCE(NULLIF(TRIM(cand.sale_closer), ''), c.closer_id),
  feedback_at = COALESCE(c.feedback_at, NOW()),
  updated_at = NOW()
FROM candidates AS cand
WHERE c.id = cand.check_id
  AND cand.sale_rn = 1
  AND cand.check_rn = 1;

-- 3) Fail loudly if duplicates remain
DO $$
DECLARE
  leftover int;
BEGIN
  SELECT COUNT(*) INTO leftover
  FROM (
    SELECT 1
    FROM rpm_checks
    WHERE deleted_at IS NULL
      AND member_id_normalized IS NOT NULL
      AND TRIM(member_id_normalized) <> ''
    GROUP BY company, member_id_normalized, working_day
    HAVING COUNT(*) > 1
  ) AS d;
  IF leftover > 0 THEN
    RAISE EXCEPTION 'rpm_checks member+day duplicates remain: % groups', leftover;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rpm_checks_company_member_day
  ON rpm_checks (company, member_id_normalized, working_day)
  WHERE deleted_at IS NULL AND member_id_normalized IS NOT NULL;

INSERT INTO notification_routing_rules (
  company, action_key, label, description, recipient_roles, recipient_usernames, enabled, updated_at
)
VALUES (
  'hangup',
  'rpm_sale_duplicate',
  'RPM duplicate phone / Member ID',
  'When a closer submits an RPM sale whose phone (main or alternative) or Member ID already exists',
  ARRAY['quality', 'rtm', 'admin']::text[],
  ARRAY[]::text[],
  true,
  NOW()
)
ON CONFLICT (company, action_key) DO UPDATE
SET
  recipient_roles = ARRAY['quality', 'rtm', 'admin']::text[],
  updated_at = NOW();

UPDATE notification_routing_rules
SET
  recipient_roles = ARRAY['quality', 'rtm', 'admin']::text[],
  updated_at = NOW()
WHERE action_key = 'rpm_sale_duplicate'
  AND company = 'hangup';
