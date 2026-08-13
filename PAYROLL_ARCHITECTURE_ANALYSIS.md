# Payroll Processing Architecture Analysis & Troubleshooting Framework

**Date:** 2026-07-21  
**Analyst:** Kilo  
**Application:** Hangup Portal  
**Scope:** DB-layer vs App-layer payroll processing, HS1-12 discrepancy investigation

---

## 1. Comparative Architectural Analysis

### 1.1 Current Architecture (Application Layer)

Hangup Portal currently performs all payroll calculations in the **Node.js application layer**:

```
┌─────────────────────────────────────────────┐
│          Electron / Express Server           │
│  ┌─────────────────────────────────────────┐ │
│  │  lib/payroll.js                         │ │
│  │  - buildPayroll()                       │ │
│  │  - calcPayrollRow()                     │ │
│  │  - bonusBreakdown()                     │ │
│  │  - deductionBreakdown()                 │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  lib/data-store.js                      │ │
│  │  - getAttendanceEvents()                │ │
│  │  - getPayrollAdjustments()              │ │
│  │  - buildAttendanceMap()                 │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  routes/api.js                          │ │
│  │  - buildEnrichedPayrollForMonth()       │ │
│  │  - GET /payroll                         │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│         Supabase PostgreSQL                  │
│  - attendance_events (raw data)             │
│  - payroll_adjustments (overrides only)     │
│  - employees (master data)                  │
└─────────────────────────────────────────────┘
```

**Key characteristics:**
- All arithmetic performed in Node.js
- Supabase is a **storage backend**, not a computation engine
- Payroll adjustments are stored as overrides, not derived values
- No database-level enforcement of calculation logic

### 1.2 Proposed Architecture (Database Layer)

```
┌─────────────────────────────────────────────┐
│          Electron / Express Server           │
│  ┌─────────────────────────────────────────┐ │
│  │  routes/api.js                          │ │
│  │  - GET /payroll                         │ │
│  │  - Calls DB function:                   │ │
│  │    SELECT * FROM calculate_payroll(?);  │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│         Supabase PostgreSQL                  │
│  ┌─────────────────────────────────────────┐ │
│  │  Stored Procedure:                      │ │
│  │  calculate_payroll(month)               │ │
│  │  - Reads attendance_events              │ │
│  │  - Reads payroll_adjustments            │ │
│  │  - Applies depart auto-OUT              │ │
│  │  - Computes working days                │ │
│  │  - Calculates salary, bonuses,          │ │
│  │    deductions, transport                │ │
│  │  - Returns payroll rows                 │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Triggers:                              │ │
│  │  - AFTER INSERT/UPDATE on              │ │
│  │    attendance_events                    │ │
│  │    → auto-recalculate affected payroll │ │
│  │  - AFTER UPDATE on employees           │ │
│  │    → invalidate payroll cache          │ │
│  └─────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────┐ │
│  │  Views:                                 │ │
│  │  - vw_payroll_current_month            │ │
│  │  - vw_employee_attendance_summary      │ │
│  │  - vw_transport_eligibility            │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

---

### 1.3 Detailed Comparison

| Criterion | Application Layer (Current) | Database Layer (Proposed) |
|-----------|----------------------------|---------------------------|
| **Data Integrity** | ⚠️ Medium | ✅ High |
| **Performance** | ⚠️ Medium (network round-trips) | ✅ High (set-based operations) |
| **Concurrency Control** | ⚠️ Manual locking required | ✅ Native MVCC + row locking |
| **Scalability** | ⚠️ Requires app server scaling | ✅ DB handles computation scale |
| **Auditability** | ⚠️ Requires explicit logging | ✅ Triggers auto-log changes |
| **Debugging** | ✅ Easy (source maps, breakpoints) | ⚠️ Harder (DB logs, RAISE NOTICE) |
| **Portability** | ✅ Language-agnostic | ⚠️ DB-specific SQL |
| **Real-time Sync** | ⚠️ Requires custom logic | ✅ Triggers push changes instantly |
| **Testing** | ✅ Unit tests easy | ⚠️ Requires DB test containers |
| **Deployment** | ⚠️ Requires app redeploy | ⚠️ Requires DB migration deploy |

### 1.4 Data Integrity Analysis

**Application Layer Risks:**
- Calculation logic can diverge between different services (e.g., reports vs payroll)
- Cache staleness causes mismatched values (the HS1-12 bug)
- No enforcement mechanism — a bug in `lib/payroll.js` silently produces wrong results
- Requires disciplined testing across all consumers

**Database Layer Benefits:**
- Single source of truth: all consumers query the same function
- Triggers ensure derived data stays consistent
- CHECK constraints enforce business rules at the schema level
- Transaction atomicity: payroll calc + save happens in one ACID transaction

### 1.5 Performance Analysis

**Application Layer:**
```
For each employee:
  1. Fetch attendance (N+1 if not cached)
  2. Fetch bonuses
  3. Fetch deductions
  4. Fetch adjustments
  5. Fetch commission tiers
  6. Calculate in memory
  7. Write results

Total: ~7-10 queries per employee × 100 employees = 700-1000 queries
```

**Database Layer:**
```
Single query:
  SELECT * FROM calculate_payroll('2026-07');
  
Internal:
  - Set-based JOINs across all tables
  - Window functions for running totals
  - Single round-trip

Total: 1 query, ~50-200ms regardless of employee count
```

### 1.6 Concurrency Control

**Application Layer:**
- Must implement distributed locks (e.g., `withStoreMutationLock` in `lib/data-store.js`)
- Risk of race conditions during concurrent edits
- Live sync via SSE adds complexity

**Database Layer:**
- PostgreSQL MVCC handles concurrent reads/writes natively
- `SELECT ... FOR UPDATE` locks specific rows
- Triggers fire in transaction context — no partial updates possible

### 1.7 Long-term Scalability

**Application Layer:**
- Vertical scaling: more app servers, more memory per calculation
- Each server maintains its own cache — cache coherence is a challenge
- Adding new payroll rules requires app deployment

**Database Layer:**
- Horizontal scaling: read replicas handle payroll queries
- Materialized views pre-compute expensive aggregations
- New rules = new stored procedure version (can coexist during migration)

---

## 2. Implementation Strategies

### 2.1 Stored Procedures (PostgreSQL)

```sql
CREATE OR REPLACE FUNCTION calculate_payroll(
  p_month TEXT,
  p_company TEXT DEFAULT 'hangup'
) RETURNS TABLE (
  employee_id TEXT,
  name TEXT,
  working_days INTEGER,
  basic_salary NUMERIC,
  transport_allowance NUMERIC,
  total_bonuses NUMERIC,
  total_deductions NUMERIC,
  net_salary NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH 
  -- Attendance aggregation with depart auto-OUT
  attendance_summary AS (
    SELECT 
      ae.employee_id,
      COUNT(CASE WHEN ae.status IN ('Attended', 'Day-OFF', 'Half Day', 'Quarter Day-Off', 'Lateness A', 'Lateness B') 
                  AND NOT (ae.date > e.depart_date) THEN 1 END) as working_days,
      COUNT(CASE WHEN ae.status = 'Day-OFF' AND ae.paid_leave THEN 1 END) as paid_leave,
      COUNT(CASE WHEN ae.status = 'Half Day' THEN 1 END) as half_days,
      COUNT(CASE WHEN ae.status = 'Quarter Day-Off' THEN 1 END) as quarter_off,
      COUNT(CASE WHEN ae.status = 'Lateness A' OR ae.status = 'Lateness B' THEN 1 END) as lateness
    FROM attendance_events ae
    JOIN employees e ON e.id = ae.employee_id
    WHERE ae.date LIKE p_month || '%'
      AND (e.depart_date IS NULL OR ae.date <= e.depart_date)
    GROUP BY ae.employee_id
  ),
  -- Payroll adjustments
  adjustments AS (
    SELECT * FROM payroll_adjustments 
    WHERE year_month = p_month
  ),
  -- Position rates
  rates AS (
    SELECT * FROM position_rates 
    WHERE year_month = p_month
  )
  SELECT 
    e.id,
    e.american_name,
    COALESCE(a.working_days, 0),
    -- Basic salary calculation
    COALESCE(a.working_days, 0) * COALESCE(r.monthly_rate, 0) / NULLIF(a.working_days_in_month, 0),
    -- Transport allowance (integrated with attendance rules)
    calculate_transport(a.working_days, a.paid_leave, e.transport_eligible),
    -- ... bonuses, deductions, net salary
  FROM employees e
  LEFT JOIN attendance_summary a ON a.employee_id = e.id
  LEFT JOIN adjustments adj ON adj.employee_id = e.id
  LEFT JOIN rates r ON r.position = e.position
  WHERE e.status IN ('Active', 'Paused', 'OUT BUT STILL GET PAID')
     OR (e.status = 'OUT' AND EXISTS (SELECT 1 FROM attendance_summary a2 WHERE a2.employee_id = e.id));
END;
$$ LANGUAGE plpgsql;
```

### 2.2 Triggers

```sql
-- Auto-recalculate payroll when attendance changes
CREATE OR REPLACE FUNCTION trigger_recalc_payroll()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    -- Invalidate cached payroll for affected employee/month
    INSERT INTO payroll_cache_invalidation (employee_id, year_month)
    VALUES (NEW.employee_id, to_char(NEW.date, 'YYYY-MM'))
    ON CONFLICT DO NOTHING;
    
    -- Optionally: auto-recalculate immediately
    -- PERFORM calculate_payroll(to_char(NEW.date, 'YYYY-MM'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendance_payroll_recalc
AFTER INSERT OR UPDATE ON attendance_events
FOR EACH ROW EXECUTE FUNCTION trigger_recalc_payroll();
```

### 2.3 Database Views

```sql
-- Simplified payroll view for reporting
CREATE VIEW vw_payroll_current_month AS
SELECT 
  e.id,
  e.american_name,
  e.unit,
  e.position,
  COALESCE(a.working_days, 0) as working_days,
  COALESCE(adj.monthly_salary_override, r.monthly_rate) as monthly_salary,
  calculate_transport_days(COALESCE(a.working_days, 0)) as transport_days,
  -- ... other fields
FROM employees e
LEFT JOIN (
  SELECT employee_id, 
         COUNT(*) FILTER (WHERE status IN ('Attended', 'Day-OFF')) as working_days
  FROM attendance_events
  WHERE date LIKE to_char(now(), 'YYYY-MM') || '%'
  GROUP BY employee_id
) a ON a.employee_id = e.id
LEFT JOIN payroll_adjustments adj ON adj.employee_id = e.id 
  AND adj.year_month = to_char(now(), 'YYYY-MM')
LEFT JOIN position_rates r ON r.position = e.position 
  AND r.year_month = to_char(now(), 'YYYY-MM');

-- Materialized view for expensive reports
CREATE MATERIALIZED VIEW mv_payroll_monthly_summary AS
SELECT 
  to_char(date, 'YYYY-MM') as month,
  employee_id,
  COUNT(*) as total_days,
  COUNT(*) FILTER (WHERE status = 'Attended') as attended_days,
  COUNT(*) FILTER (WHERE status = 'OUT') as out_days
FROM attendance_events
GROUP BY 1, 2;
```

### 2.4 Best Practices

| Practice | Implementation |
|----------|----------------|
| **Immutability** | Store raw attendance only; derive payroll via views/functions |
| **Versioning** | Use `payroll_calc_version` column to track which calculation logic produced a result |
| **Audit logging** | `payroll_audit` table with `calc_version`, `input_hash`, `result_hash` |
| **Idempotency** | Same inputs → same outputs (deterministic functions) |
| **Graceful degradation** | Fallback to app-layer if DB function fails |
| **Testing** | Golden master tests: DB calc vs known-correct values |
| **Security** | `SECURITY DEFINER` functions with `SET search_path = public` |
| **Performance** | Index on `attendance_events(employee_id, date)`, materialized views for reports |

---

## 3. Technical Troubleshooting Framework: HS1-12 Salary Discrepancy

### 3.1 Investigation Protocol

```
┌─────────────────────────────────────────────────────────────┐
│   STEP 1: IDENTIFY THE DISCREPANCY                           │
│   - Get expected value from database                         │
│   - Get displayed value from payroll module                  │
│   - Document the delta                                        │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│   STEP 2: VERIFY SOURCE DATA                                 │
│   - Check attendance_events for HS1-12 in target month       │
│   - Count working days manually                              │
│   - Check depart_date and apply auto-OUT rules               │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│   STEP 3: ISOLATE THE CALCULATION LAYER                      │
│   - Compare app-layer calc vs DB-layer calc (if exists)      │
│   - Check for cached/stale values                            │
│   - Verify which layer is producing the displayed value      │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│   STEP 4: IDENTIFY ROOT CAUSE                                │
│   - Logic mismatch? Cache issue? Trigger malfunction?        │
│   - Check for the "22 working days" bug                      │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│   STEP 5: VERIFY TRANSPORT ALLOWANCE INTEGRATION             │
│   - Confirm transport calc uses updated attendance rules     │
│   - Test edge cases: depart dates, half days, WFH           │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Step-by-Step Investigation

#### STEP 1: Identify the Discrepancy

```javascript
// Diagnostic script
const employeeId = 'HS1-12';
const month = '2026-07';

// Get database value
const dbSalary = await supabase
  .from('payroll_adjustments')
  .select('monthly_salary_override')
  .eq('employee_id', employeeId)
  .eq('year_month', month)
  .single();

// Get payslip displayed value
const payslip = await buildPayslip(employeeId, month);
const displayedSalary = payslip.basicSalary;

console.log('Database value:', dbSalary?.monthly_salary_override);
console.log('Displayed value:', displayedSalary);
console.log('Delta:', displayedSalary - (dbSalary?.monthly_salary_override || 0));
```

**Expected finding:** Database has `monthly_salary_override = null` (no override), but payslip shows a calculated value based on working days.

#### STEP 2: Verify Source Data

```sql
-- Check attendance for HS1-12 in July 2026
SELECT 
  date,
  status,
  transport_override,
  CASE 
    WHEN date > e.depart_date THEN 'POST-DEPART (should be OUT)'
    ELSE 'VALID'
  END as validation_flag
FROM attendance_events ae
JOIN employees e ON e.id = ae.employee_id
WHERE ae.employee_id = 'HS1-12'
  AND ae.date LIKE '2026-07%'
ORDER BY ae.date;

-- Count working days (correct calculation)
SELECT 
  COUNT(*) FILTER (WHERE status IN ('Attended', 'Day-OFF', 'Half Day', 'Quarter Day-Off', 'Lateness A', 'Lateness B')) as working_days,
  COUNT(*) FILTER (WHERE status = 'OUT') as out_days,
  COUNT(*) as total_records
FROM attendance_events
WHERE employee_id = 'HS1-12'
  AND date LIKE '2026-07%'
  AND date <= (SELECT depart_date FROM employees WHERE id = 'HS1-12');
```

**Known bug pattern:**
```
If depart_date = '2026-07-17':
  - Days 1-17: should count as working (if Attended)
  - Days 18-31: should be OUT (not counted)
  - Correct working days: ~17
  - Buggy calculation: 22 (includes post-depart days)
```

#### STEP 3: Isolate the Calculation Layer

```javascript
// Test 1: App-layer calculation
const appPayroll = await buildEnrichedPayrollForMonth('2026-07', req, {});
const hs1Row = appPayroll.payroll.find(r => r.employeeId === 'HS1-12');
console.log('App-layer workingDays:', hs1Row?.totalWorkingDays);

// Test 2: Check if depart auto-OUT is applied
const rawRecords = store.getAttendanceEvents('2026-07');
const hs1Records = rawRecords.filter(r => r.employeeId === 'HS1-12');
const attendedAfterDepart = hs1Records.filter(r => {
  const depart = '2026-07-17';
  return r.date > depart && r.status === 'Attended';
});
console.log('Attended records after depart date:', attendedAfterDepart.length);

// Test 3: Apply depart auto-OUT manually
const { applyDepartAutoOutForMonth } = require('./lib/attendance');
const employees = store.getEmployeeById('HS1-12');
const correctedRecords = applyDepartAutoOutForMonth([employees], hs1Records, '2026-07');
const correctedWorkingDays = correctedRecords.filter(r => 
  r.status === 'Attended' || r.status === 'Day-OFF'
).length;
console.log('Corrected working days:', correctedWorkingDays);
```

**Root cause indicators:**
- If `appPayroll.workingDays = 22` but `correctedWorkingDays = 17` → **Bug is in app-layer** (missing depart auto-OUT in payroll path)
- If both show 22 → **Bug is in source data** (attendance records themselves are wrong)
- If DB trigger exists but produces wrong result → **Trigger logic bug**

#### STEP 4: Identify Root Cause

Based on the investigation in this session, the root cause is:

**Primary Issue:** `buildEnrichedPayrollForMonth()` in `routes/api.js` does NOT call `applyDepartAutoOutForMonth()` before building payroll summaries, while the attendance view (`GET /api/attendance`) does.

**Secondary Issue:** The `readAttendanceEventsForMonth()` path returns cached data that may not reflect the latest depart date status.

**Tertiary Issue:** Bulk attendance actions (`bulk-agent-month`, `bulk-weekdays`) have no validation against existing depart dates, allowing users to overwrite post-depart days with "Attended".

#### STEP 5: Verify Transport Allowance Integration

```javascript
// Transport allowance verification
const transport = calcTransportAllowance(
  attendanceRecords,
  workingDaysInMonth,
  config,
  resolved.transportEligible
);

// Verify transport calc uses corrected attendance
console.log('Transport days:', transport.days);
console.log('Transport daily rate:', transport.dailyRate);

// Edge cases to test:
// 1. Agent with depart date mid-month
// 2. Agent with half days after depart date (should be OUT)
// 3. Agent with WFH after depart date (should be OUT)
// 4. Agent with no depart date (normal calculation)
```

---

## 4. Detailed Comparison Matrix

### 4.1 Data Integrity

| Aspect | Application Layer | Database Layer |
|--------|-------------------|----------------|
| **Calculation enforcement** | ⚠️ Relies on disciplined code review | ✅ Triggers enforce automatically |
| **Cache coherence** | ⚠️ Stale cache causes mismatches | ✅ Single source of truth |
| **Audit trail** | ⚠️ Must be explicitly implemented | ✅ Triggers + audit tables |
| **Rollback capability** | ⚠️ Requires manual compensation | ✅ Transaction rollback |

### 4.2 Performance

| Metric | Application Layer | Database Layer |
|--------|-------------------|----------------|
| **Query count** | 7-10 per employee | 1 (set-based) |
| **Network round-trips** | N × (employees + records) | 1-2 |
| **Memory usage** | O(employees × records) | O(1) in app, O(N) in DB |
| **Cache efficiency** | ⚠️ Coherence issues | ✅ DB buffer cache |

### 4.3 Concurrency Control

| Aspect | Application Layer | Database Layer |
|--------|-------------------|----------------|
| **Race conditions** | ⚠️ Manual locks needed | ✅ MVCC handles automatically |
| **Deadlock risk** | ⚠️ Application-level | ⚠️ Database-level (but rare) |
| **Partial updates** | ⚠️ Possible during crash | ✅ Atomic transactions |
| **Live sync** | ⚠️ Custom SSE implementation | ✅ LISTEN/NOTIFY built-in |

### 4.4 Long-term Scalability

| Factor | Application Layer | Database Layer |
|--------|-------------------|----------------|
| **Employee growth** | Linear scaling (more RAM/CPU) | Set-based handles 10K+ easily |
| **New calculations** | ⚠️ Requires deploy | ⚠️ Requires migration (but safer) |
| **Multi-company** | ⚠️ Requires careful scoping | ✅ RLS + company column |
| **Reporting** | ⚠️ Aggregation in app | ✅ Materialized views |

---

## 5. Recommendation

### 5.1 Hybrid Approach (Recommended)

For Hangup Portal's current maturity level, a **hybrid approach** provides the best balance:

```
┌─────────────────────────────────────────────┐
│       Application Layer (Current)           │
│  - UI rendering                             │
│  - User interactions                        │
│  - Live sync via SSE                        │
│  - PDF generation                           │
│  - Client-side validation                   │
└─────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│       Database Layer (New)                  │
│  - Payroll calculation function             │
│  - Depart auto-OUT trigger                  │
│  - Transport allowance calculation          │
│  - Payroll cache invalidation               │
│  - Audit logging                            │
└─────────────────────────────────────────────┘
```

**Why hybrid:**
1. **Low risk**: App layer still handles UI/UX; DB layer only adds enforcement
2. **Gradual migration**: Can move one calculation at a time
3. **Fallback**: App layer can call DB function and fall back to local calc if needed
4. **Best of both**: UI flexibility + DB integrity

### 5.2 Implementation Roadmap

| Phase | Scope | Effort | Risk |
|-------|-------|--------|------|
| **Phase 1** | Fix current bugs (depart auto-OUT in payroll, cache refresh) | 1-2 days | Low |
| **Phase 2** | Add `refreshAttendanceFromSupabase()` to payroll path | 1 day | Low |
| **Phase 3** | Create `calculate_payroll()` stored procedure (read-only) | 3-5 days | Medium |
| **Phase 4** | Add triggers for auto-recalculation | 2-3 days | Medium |
| **Phase 5** | Migrate app layer to use DB function with fallback | 3-5 days | Medium |
| **Phase 6** | Add materialized views for reports | 2-3 days | Low |

### 5.3 Critical Path for HS1-12 Bug

```
Immediate (today):
  ✅ Fix buildEnrichedPayrollForMonth() to apply depart auto-OUT
  ✅ Add refreshAttendanceFromSupabase() before payroll calc
  
Short-term (this week):
  - Add validation to bulk attendance endpoints
  - Add frontend warning for depart date conflicts
  
Medium-term (next sprint):
  - Create calculate_payroll() stored procedure
  - Add triggers for auto-recalculation
  - Add materialized view for payroll reports
```

---

## 6. Security Considerations

### 6.1 Stored Procedure Security

```sql
-- Use SECURITY DEFINER carefully
CREATE OR REPLACE FUNCTION calculate_payroll(...)
RETURNS TABLE (...) AS $$
BEGIN
  -- Validate inputs
  IF p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid month format';
  END IF;
  
  -- Prevent SQL injection
  EXECUTE format('SELECT ... WHERE year_month = %L', p_month);
  
  -- Return only authorized columns
  -- (no sensitive fields like bank_account, ssn)
END;
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public;  -- Prevent schema hijacking
```

### 6.2 Trigger Security

```sql
-- Triggers should NOT:
-- - Send emails
-- - Call external APIs
-- - Modify data in other tables (except audit logs)
-- - Use dynamic SQL without validation

-- Triggers SHOULD:
-- - Validate data consistency
-- - Log changes to audit table
-- - Invalidate caches
-- - Enforce business rules
```

### 6.3 View Security

```sql
-- Use Row Level Security (RLS)
ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_company_scope ON attendance_events
  FOR ALL TO app_role
  USING (
    employee_id IN (
      SELECT id FROM employees 
      WHERE company = current_setting('app.current_company', true)
    )
  );
```

---

## 7. Conclusion

The current application-layer architecture has served Hangup Portal well but shows clear limitations in data integrity (cache staleness, missing enforcement) and performance (N+1 queries, no set-based operations). The database-layer approach offers superior integrity, performance, and scalability but requires significant investment in SQL development and testing.

**Recommended path:** Implement a hybrid approach where the database layer enforces core calculation rules (depart auto-OUT, transport allowance, basic salary derivation) while the application layer handles UI concerns and provides a fallback. This maintains current functionality while progressively improving data integrity.

The HS1-12 discrepancy is a clear symptom of the application-layer approach: the attendance view correctly applies depart auto-OUT, but the payroll path does not. The fix (adding `applyDepartAutoOutForMonth` to `buildEnrichedPayrollForMonth`) is a step toward the hybrid model.
