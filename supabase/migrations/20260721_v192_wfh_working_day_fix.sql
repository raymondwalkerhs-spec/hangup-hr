-- ============================================================
-- Fix WFH (Work From Home) classification in payroll calculation
-- ============================================================
-- WFH should be treated as a working day for basic salary
-- but excluded from transportation allowance.
--
-- This script drops and recreates the calculate_payroll_core
-- function with updated working_days aggregation.
-- ============================================================

DROP FUNCTION IF EXISTS calculate_payroll_core(text, text);

CREATE OR REPLACE FUNCTION calculate_payroll_core(
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
  extra_days integer,
  monthly_salary numeric,
  daily_rate numeric,
  transport_days numeric,
  transport_daily_rate numeric,
  transport_allowance numeric,
  basic_salary numeric
) AS $$
BEGIN
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
    0::integer AS extra_days,
    ed.monthly_salary::numeric AS monthly_salary,
    CASE WHEN COALESCE(att.working_days, 0) > 0 
      THEN round(ed.monthly_salary / att.working_days * 100) / 100 
      ELSE 0 
    END::numeric AS daily_rate,
    COALESCE(tr.transport_days, 0)::numeric AS transport_days,
    COALESCE(tr.transport_daily_rate, 0)::numeric AS transport_daily_rate,
    COALESCE(tr.transport_allowance, 0)::numeric AS transport_allowance,
    CASE WHEN COALESCE(att.working_days, 0) > 0 
      THEN round((COALESCE(att.working_days, 0) + COALESCE(att.paid_leave_days, 0) + COALESCE(att.half_days, 0) * 0.5 + COALESCE(att.quarter_off, 0) * 0.25 + COALESCE(att.lateness, 0) - COALESCE(att.nsnc, 0) * 2 - COALESCE(att.nsnc_half, 0) * 1.5) * (ed.monthly_salary / NULLIF(att.working_days, 0)) * 100) / 100
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
      -- FIX: Include WFH in working_days so basic salary is calculated
      COUNT(*) FILTER (WHERE v.status IN ('Attended', 'Day-OFF', 'WFH', 'Half Day', 'Quarter Day-Off', 'Lateness A', 'Lateness B')) AS working_days,
      COUNT(*) FILTER (WHERE v.status = 'Day-OFF' AND v.paid_leave) AS paid_leave_days,
      COUNT(*) FILTER (WHERE v.status = 'Day-OFF') AS days_off,
      COUNT(*) FILTER (WHERE v.status = 'Half Day') AS half_days,
      COUNT(*) FILTER (WHERE v.status = 'Quarter Day-Off') AS quarter_off,
      COUNT(*) FILTER (WHERE v.status = 'WFH') AS wfh,
      COUNT(*) FILTER (WHERE v.status IN ('Lateness A', 'Lateness B')) AS lateness,
      COUNT(*) FILTER (WHERE v.status = 'NSNC') AS nsnc,
      COUNT(*) FILTER (WHERE v.status = 'NSNC Half Day') AS nsnc_half,
      COUNT(*) FILTER (WHERE v.status = 'paused') AS paused
    FROM vw_employee_month_attendance v
    WHERE v.date::text LIKE p_month || '%'
      AND (p_employee_id IS NULL OR v.employee_id = p_employee_id)
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
          ELSE 0
        END
      ), 0) AS transport_days,
      round(COALESCE(SUM(
        CASE 
          WHEN v2.status = 'WFH' OR v2.status = 'Work from home' THEN 0
          WHEN v2.status IN ('Attended') THEN 1
          WHEN v2.status IN ('Half Day', 'NSNC Half Day', 'Lateness A', 'Lateness B', 'Quarter Day-Off') THEN
            CASE v2.transport_override
              WHEN 'full' THEN 1
              WHEN 'half' THEN 0.5
              ELSE 0
            END
          ELSE 0
        END
      ), 0) * 3000 / NULLIF((SELECT COUNT(*) FROM vw_employee_month_attendance v3 WHERE v3.employee_id = v2.employee_id AND v3.date::text LIKE p_month || '%' AND v3.is_weekend = false AND v3.status != 'OUT'), 0) * 100) / 100 AS transport_daily_rate,
      round(COALESCE(SUM(
        CASE 
          WHEN v2.status = 'WFH' OR v2.status = 'Work from home' THEN 0
          WHEN v2.status IN ('Attended') THEN 1
          WHEN v2.status IN ('Half Day', 'NSNC Half Day', 'Lateness A', 'Lateness B', 'Quarter Day-Off') THEN
            CASE v2.transport_override
              WHEN 'full' THEN 1
              WHEN 'half' THEN 0.5
              ELSE 0
            END
          ELSE 0
        END
      ), 0) * 3000 / NULLIF((SELECT COUNT(*) FROM vw_employee_month_attendance v3 WHERE v3.employee_id = v2.employee_id AND v3.date::text LIKE p_month || '%' AND v3.is_weekend = false AND v3.status != 'OUT'), 0) * 100) / 100 AS transport_allowance
    FROM vw_employee_month_attendance v2
    WHERE v2.employee_id = p_employee_id
      AND v2.date::text LIKE p_month || '%'
      AND v2.is_weekend = false
      AND v2.status != 'OUT'
    GROUP BY v2.employee_id
  ) tr ON tr.employee_id = ed.emp_id
  ORDER BY ed.unit, ed.american_name;
END;
$$ LANGUAGE plpgsql STABLE;
