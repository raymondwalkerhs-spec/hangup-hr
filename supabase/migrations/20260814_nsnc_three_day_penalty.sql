-- NSNC / Not Approved day-off = 3 salary days in calculate_payroll_core.
-- Company rules: the missed day itself + 2 extra deducted days.
-- Those statuses are not in working_days, so paid units are:
--   (working_days + nsnc) - nsnc * 3
-- which is the 3-day rule written explicitly in SQL (no app-layer change).

DROP FUNCTION IF EXISTS get_payroll_core_with_fallback(text, text);
DROP FUNCTION IF EXISTS calculate_payroll_core(text, text);
DROP FUNCTION IF EXISTS calculate_payroll_core(text, text, integer);

CREATE OR REPLACE FUNCTION calculate_payroll_core(
  p_month text,
  p_employee_id text DEFAULT NULL,
  p_working_days_in_month integer DEFAULT NULL
) RETURNS TABLE (
  employee_id text,
  name text,
  unit text,
  "position" text,
  working_days integer,
  paid_leave_days integer,
  days_off integer,
  half_days integer,
  quarter_off integer,
  wfh integer,
  lateness integer,
  nsnc integer,
  nsnc_half integer,
  paused integer,
  out_days integer,
  extra_days integer,
  monthly_salary numeric,
  daily_rate numeric,
  transport_days numeric,
  transport_daily_rate numeric,
  transport_allowance numeric,
  basic_salary numeric
) AS $$
DECLARE
  v_month_wd integer;
BEGIN
  SELECT COALESCE(
    NULLIF(p_working_days_in_month, 0),
    (
      SELECT COUNT(*)::integer
      FROM generate_series(
        (p_month || '-01')::date,
        ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date,
        INTERVAL '1 day'
      ) d
      WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
    )
  )
  INTO v_month_wd;

  IF v_month_wd IS NULL OR v_month_wd <= 0 THEN
    v_month_wd := 1;
  END IF;

  RETURN QUERY
  SELECT
    ed.emp_id::text AS employee_id,
    ed.american_name::text AS name,
    ed.unit::text AS unit,
    ed.position::text AS "position",
    COALESCE(att.working_days, 0)::integer AS working_days,
    COALESCE(att.paid_leave_days, 0)::integer AS paid_leave_days,
    COALESCE(att.days_off, 0)::integer AS days_off,
    COALESCE(att.half_days, 0)::integer AS half_days,
    COALESCE(att.quarter_off, 0)::integer AS quarter_off,
    COALESCE(att.wfh, 0)::integer AS wfh,
    COALESCE(att.lateness, 0)::integer AS lateness,
    COALESCE(att.nsnc, 0)::integer AS nsnc,
    COALESCE(att.nsnc_half, 0)::integer AS nsnc_half,
    COALESCE(att.paused, 0)::integer AS paused,
    COALESCE(att.out_days, 0)::integer AS out_days,
    0::integer AS extra_days,
    ed.monthly_salary::numeric AS monthly_salary,
    CASE WHEN v_month_wd > 0 AND ed.monthly_salary > 0
      THEN round(ed.monthly_salary / v_month_wd * 100) / 100
      ELSE 0
    END::numeric AS daily_rate,
    COALESCE(tr.transport_days, 0)::numeric AS transport_days,
    CASE WHEN v_month_wd > 0
      THEN round((3000::numeric / v_month_wd) * 100) / 100
      ELSE 0
    END::numeric AS transport_daily_rate,
    COALESCE(tr.transport_allowance, 0)::numeric AS transport_allowance,
    -- 3 salary days per NSNC / Not Approved day off: restore the missed day, then subtract 3.
    CASE WHEN v_month_wd > 0 AND ed.monthly_salary > 0
      THEN round(
        (
          COALESCE(att.working_days, 0)
          + COALESCE(att.nsnc, 0)
          - COALESCE(att.unpaid_half_days, 0) * 0.5
          - COALESCE(att.unpaid_quarter_off, 0) * 0.25
          - COALESCE(att.nsnc, 0) * 3
          - COALESCE(att.nsnc_half, 0) * 1.5
        ) * (ed.monthly_salary / v_month_wd) * 100
      ) / 100
      ELSE 0
    END::numeric AS basic_salary
  FROM (
    SELECT
      e.id AS emp_id,
      e.american_name,
      e.unit,
      e.position,
      COALESCE(prm.monthly_salary, pr.monthly_salary, 0) AS monthly_salary
    FROM employees e
    LEFT JOIN position_rate_monthly prm
      ON prm.position = e.position
      AND prm.year_month = p_month
      AND prm.company = CASE WHEN e.unit LIKE 'HS2%' OR e.unit LIKE 'PT%' THEN 'hs2' ELSE 'hangup' END
    LEFT JOIN position_rates pr
      ON pr.position = e.position
      AND pr.company = CASE WHEN e.unit LIKE 'HS2%' OR e.unit LIKE 'PT%' THEN 'hs2' ELSE 'hangup' END
    WHERE e.deleted_at IS NULL
      AND (p_employee_id IS NULL OR e.id = p_employee_id)
  ) ed
  LEFT JOIN (
    SELECT
      v.employee_id,
      COUNT(*) FILTER (
        WHERE v.status IN ('Attended', 'WFH', 'Half Day', 'Quarter Day-Off', 'Lateness A', 'Lateness B')
          OR (v.status = 'Day-OFF' AND v.paid_leave)
      ) AS working_days,
      COUNT(*) FILTER (WHERE v.status = 'Day-OFF' AND v.paid_leave) AS paid_leave_days,
      COUNT(*) FILTER (WHERE v.status = 'Day-OFF') AS days_off,
      COUNT(*) FILTER (WHERE v.status = 'Half Day') AS half_days,
      COUNT(*) FILTER (WHERE v.status = 'Quarter Day-Off') AS quarter_off,
      COUNT(*) FILTER (WHERE v.status = 'Half Day' AND NOT COALESCE(v.paid_leave, false)) AS unpaid_half_days,
      COUNT(*) FILTER (WHERE v.status = 'Quarter Day-Off' AND NOT COALESCE(v.paid_leave, false)) AS unpaid_quarter_off,
      COUNT(*) FILTER (WHERE v.status = 'WFH') AS wfh,
      COUNT(*) FILTER (WHERE v.status IN ('Lateness A', 'Lateness B')) AS lateness,
      COUNT(*) FILTER (
        WHERE lower(btrim(v.status)) IN (
          'nsnc',
          'not approved day off',
          'day off (not approved)',
          'day-off not approved',
          'day off not approved'
        )
      ) AS nsnc,
      COUNT(*) FILTER (
        WHERE lower(btrim(v.status)) IN ('nsnc half day', 'not approved half day')
      ) AS nsnc_half,
      COUNT(*) FILTER (WHERE v.status = 'paused') AS paused,
      COUNT(*) FILTER (WHERE v.status IN ('OUT', 'OUT BUT STILL GET PAID')) AS out_days
    FROM employee_month_attendance(p_month) v
    WHERE (p_employee_id IS NULL OR v.employee_id = p_employee_id)
      AND v.status != 'OUT'
    GROUP BY v.employee_id
  ) att ON att.employee_id = ed.emp_id
  LEFT JOIN (
    SELECT
      v2.employee_id,
      COALESCE(SUM(
        CASE
          WHEN v2.status = 'WFH' OR v2.status = 'Work from home' THEN 0
          WHEN v2.status IN ('Attended') THEN 1
          WHEN v2.status IN ('Half Day', 'NSNC Half Day', 'Lateness A', 'Lateness B', 'Quarter Day-Off') THEN
            CASE v2.transport_override
              WHEN 'full' THEN 1
              WHEN 'half' THEN 0.5
              ELSE 0
            END
          WHEN v2.status IN ('Day-OFF', 'OUT', 'OUT BUT STILL GET PAID') THEN 0
          ELSE 0
        END
      ), 0) AS transport_days,
      round(
        COALESCE(SUM(
          CASE
            WHEN v2.status = 'WFH' OR v2.status = 'Work from home' THEN 0
            WHEN v2.status IN ('Attended') THEN 1
            WHEN v2.status IN ('Half Day', 'NSNC Half Day', 'Lateness A', 'Lateness B', 'Quarter Day-Off') THEN
              CASE v2.transport_override
                WHEN 'full' THEN 1
                WHEN 'half' THEN 0.5
                ELSE 0
              END
            WHEN v2.status IN ('Day-OFF', 'OUT', 'OUT BUT STILL GET PAID') THEN 0
            ELSE 0
          END
        ), 0) * (3000::numeric / NULLIF(v_month_wd, 0)) * 100
      ) / 100 AS transport_allowance
    FROM employee_month_attendance(p_month) v2
    WHERE (p_employee_id IS NULL OR v2.employee_id = p_employee_id)
      AND v2.is_weekend = false
      AND v2.status NOT IN ('OUT', 'Day-OFF')
    GROUP BY v2.employee_id
  ) tr ON tr.employee_id = ed.emp_id
  WHERE ed.monthly_salary > 0;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_payroll_core(text, text, integer) IS
  'Core payroll. NSNC / Not Approved day off = 3 salary days (missed day + 2 extra). daily_rate = monthly / month_working_days.';

CREATE OR REPLACE FUNCTION get_payroll_core_with_fallback(
  p_month text,
  p_employee_id text DEFAULT NULL
) RETURNS TABLE (
  employee_id text,
  name text,
  unit text,
  "position" text,
  working_days integer,
  paid_leave_days integer,
  days_off integer,
  half_days integer,
  quarter_off integer,
  wfh integer,
  lateness integer,
  nsnc integer,
  nsnc_half integer,
  paused integer,
  out_days integer,
  extra_days integer,
  monthly_salary numeric,
  daily_rate numeric,
  transport_days numeric,
  transport_daily_rate numeric,
  transport_allowance numeric,
  basic_salary numeric
) AS $$
BEGIN
  RETURN QUERY SELECT * FROM calculate_payroll_core(p_month, p_employee_id, NULL::integer);
END;
$$ LANGUAGE plpgsql STABLE;
