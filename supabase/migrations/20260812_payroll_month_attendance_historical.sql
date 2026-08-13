-- Fix hybrid payroll for historical months.
-- vw_employee_month_attendance used CURRENT_DATE only, so calculate_payroll_core('2026-07')
-- returned working_days = 0 once the calendar moved past July.
-- Also fixes transport subquery ignoring all employees when p_employee_id IS NULL.

-- ============================================================
-- 1. Month-scoped attendance (parameterized)
-- ============================================================
CREATE OR REPLACE FUNCTION employee_month_attendance(p_month text)
RETURNS TABLE (
  employee_id text,
  date date,
  status text,
  transport_override text,
  paid_leave boolean,
  updated_at timestamptz,
  is_weekend boolean,
  depart_date date,
  is_depart_auto_out boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH month_bounds AS (
    SELECT
      (p_month || '-01')::date AS month_start,
      ((p_month || '-01')::date + INTERVAL '1 month - 1 day')::date AS month_end
  ),
  month_employees AS (
    SELECT
      e.id AS employee_id,
      e.depart_date,
      generate_series(mb.month_start, mb.month_end, INTERVAL '1 day')::date AS attendance_date
    FROM employees e
    CROSS JOIN month_bounds mb
    WHERE e.deleted_at IS NULL
  ),
  month_days AS (
    SELECT
      me.employee_id,
      me.depart_date,
      me.attendance_date AS date,
      EXTRACT(DOW FROM me.attendance_date) IN (0, 6) AS is_weekend
    FROM month_employees me
  ),
  attendance_with_out AS (
    SELECT
      md.employee_id,
      md.date,
      md.is_weekend,
      md.depart_date,
      CASE
        WHEN md.is_weekend THEN 'Day-OFF'::text
        WHEN md.depart_date IS NOT NULL AND md.date > md.depart_date THEN 'OUT'::text
        ELSE COALESCE(ae.status, '')::text
      END AS status,
      COALESCE(ae.transport_override, '')::text AS transport_override,
      COALESCE(ae.paid_leave, false) AS paid_leave,
      ae.updated_at
    FROM month_days md
    LEFT JOIN attendance_events ae
      ON ae.employee_id = md.employee_id
      AND ae.date = md.date
  )
  SELECT
    a.employee_id,
    a.date,
    a.status,
    a.transport_override,
    a.paid_leave,
    a.updated_at,
    a.is_weekend,
    a.depart_date,
    CASE
      WHEN a.status = 'OUT' AND a.depart_date IS NOT NULL AND a.date > a.depart_date THEN true
      ELSE false
    END AS is_depart_auto_out
  FROM attendance_with_out a;
$$;

-- Backward-compatible view: current calendar month only
DROP VIEW IF EXISTS vw_employee_month_attendance;
CREATE VIEW vw_employee_month_attendance AS
SELECT * FROM employee_month_attendance(to_char(CURRENT_DATE, 'YYYY-MM'));

ALTER VIEW public.vw_employee_month_attendance SET (security_invoker = true);

COMMENT ON FUNCTION employee_month_attendance(text) IS
  'Employee attendance for a given YYYY-MM month with depart auto-OUT and weekend Day-OFF.';

COMMENT ON VIEW vw_employee_month_attendance IS
  'Current-month wrapper around employee_month_attendance(). Prefer the function for historical months.';

-- ============================================================
-- 2. calculate_transport_allowance — use month function
-- ============================================================
DROP FUNCTION IF EXISTS calculate_transport_allowance(text, text, bigint, integer, boolean);
CREATE OR REPLACE FUNCTION calculate_transport_allowance(
  p_employee_id text,
  p_month text,
  p_working_days_in_month bigint,
  p_monthly_budget integer DEFAULT 3000,
  p_transport_eligible boolean DEFAULT true
) RETURNS TABLE (
  days numeric,
  daily_rate numeric,
  amount numeric,
  monthly_budget numeric,
  breakdown json
) AS $$
DECLARE
  v_daily_rate numeric;
  v_total_units numeric := 0;
  v_breakdown json := '[]'::json;
  v_amount numeric;
BEGIN
  IF NOT p_transport_eligible THEN
    days := 0;
    daily_rate := 0;
    amount := 0;
    monthly_budget := p_monthly_budget;
    breakdown := '[]'::json;
    RETURN NEXT;
    RETURN;
  END IF;

  v_daily_rate := CASE WHEN p_working_days_in_month > 0
    THEN round((p_monthly_budget / p_working_days_in_month) * 100) / 100
    ELSE 0
  END;

  SELECT
    COALESCE(SUM(
      CASE
        WHEN v.status = 'WFH' OR v.status = 'Work from home' THEN 0
        WHEN v.status = 'Attended' THEN 1
        WHEN v.status IN ('Half Day', 'NSNC Half Day', 'Lateness A', 'Lateness B', 'Quarter Day-Off') THEN
          CASE v.transport_override
            WHEN 'full' THEN 1
            WHEN 'half' THEN 0.5
            ELSE 0
          END
        WHEN v.status IN ('Day-OFF', 'OUT', 'OUT BUT STILL GET PAID') THEN 0
        ELSE 0
      END
    ), 0),
    json_agg(
      json_build_object(
        'date', v.date,
        'status', v.status,
        'units',
        CASE
          WHEN v.status = 'WFH' OR v.status = 'Work from home' THEN 0
          WHEN v.status = 'Attended' THEN 1
          WHEN v.status IN ('Lateness A', 'Lateness B') THEN 0.5
          WHEN v.status IN ('Half Day', 'NSNC Half Day', 'Quarter Day-Off') THEN
            CASE v.transport_override
              WHEN 'full' THEN 1
              WHEN 'half' THEN 0.5
              ELSE 0
            END
          WHEN v.status IN ('Day-OFF', 'OUT', 'OUT BUT STILL GET PAID') THEN 0
          ELSE 0
        END,
        'override', v.transport_override
      )
    )
  INTO v_total_units, v_breakdown
  FROM employee_month_attendance(p_month) v
  WHERE v.employee_id = p_employee_id;

  v_amount := round(v_total_units * v_daily_rate * 100) / 100;

  days := v_total_units;
  daily_rate := v_daily_rate;
  amount := v_amount;
  monthly_budget := p_monthly_budget;
  breakdown := COALESCE(v_breakdown, '[]'::json);

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- 3. calculate_payroll_core — historical months + transport fix
-- ============================================================
DROP FUNCTION IF EXISTS get_payroll_core_with_fallback(text, text);
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
      COUNT(*) FILTER (WHERE v.status IN ('Attended', 'Day-OFF', 'Half Day', 'Quarter Day-Off', 'Lateness A', 'Lateness B')) AS working_days,
      COUNT(*) FILTER (WHERE v.status = 'Day-OFF' AND v.paid_leave) AS paid_leave_days,
      COUNT(*) FILTER (WHERE v.status = 'Day-OFF') AS days_off,
      COUNT(*) FILTER (WHERE v.status = 'Half Day') AS half_days,
      COUNT(*) FILTER (WHERE v.status = 'Quarter Day-Off') AS quarter_off,
      COUNT(*) FILTER (WHERE v.status = 'WFH') AS wfh,
      COUNT(*) FILTER (WHERE v.status IN ('Lateness A', 'Lateness B')) AS lateness,
      COUNT(*) FILTER (WHERE v.status = 'NSNC') AS nsnc,
      COUNT(*) FILTER (WHERE v.status = 'NSNC Half Day') AS nsnc_half,
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
          WHEN v2.status IN ('Day-OFF', 'OUT', 'OUT BUT STILL GET PAID') THEN 0
          ELSE 0
        END
      ), 0) * 3000 / NULLIF((
        SELECT COUNT(*)
        FROM employee_month_attendance(p_month) v3
        WHERE v3.employee_id = v2.employee_id
          AND v3.is_weekend = false
          AND v3.status NOT IN ('OUT', 'Day-OFF')
      ), 0) * 100) / 100 AS transport_daily_rate,
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
          WHEN v2.status IN ('Day-OFF', 'OUT', 'OUT BUT STILL GET PAID') THEN 0
          ELSE 0
        END
      ), 0) * 3000 / NULLIF((
        SELECT COUNT(*)
        FROM employee_month_attendance(p_month) v3
        WHERE v3.employee_id = v2.employee_id
          AND v3.is_weekend = false
          AND v3.status NOT IN ('OUT', 'Day-OFF')
      ), 0) * 100) / 100 AS transport_allowance
    FROM employee_month_attendance(p_month) v2
    WHERE (p_employee_id IS NULL OR v2.employee_id = p_employee_id)
      AND v2.is_weekend = false
      AND v2.status NOT IN ('OUT', 'Day-OFF')
    GROUP BY v2.employee_id
  ) tr ON tr.employee_id = ed.emp_id
  WHERE ed.monthly_salary > 0;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_payroll_core(text, text) IS
  'Core payroll calculation for any YYYY-MM month via employee_month_attendance(p_month).';

-- ============================================================
-- 4. Restore get_payroll_core_with_fallback wrapper
-- ============================================================
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
  RETURN QUERY SELECT * FROM calculate_payroll_core(p_month, p_employee_id);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'DB payroll calculation failed, app layer should fallback: %', SQLERRM;
    RETURN;
END;
$$ LANGUAGE plpgsql STABLE;
