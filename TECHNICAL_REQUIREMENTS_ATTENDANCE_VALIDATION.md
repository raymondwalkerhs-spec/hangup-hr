# Attendance Bulk Action Validation — Technical Requirements Document

**Date:** 2026-07-21  
**Author:** Kilo  
**Application:** Hangup Portal  
**Feature:** Double-check validation for bulk attendance actions when Out Date is present

---

## 1. Problem Statement

When an agent has a recorded `depart_date` (Out Date) within a month, bulk attendance actions that mark the agent as "Attended" for the entire month can silently overwrite the expected "OUT" status for days after the departure date. This causes:

- **Data integrity issues**: Attendance records after the depart date show "Attended" instead of "OUT"
- **Payroll discrepancies**: Payroll calculations count days after departure as working days, inflating salary calculations
- **Operational confusion**: Managers see conflicting data between the attendance view (which applies auto-OUT) and payroll (which does not)

### Current Behavior

| Layer | Depart Date Handling |
|-------|---------------------|
| Attendance view (`GET /api/attendance`) | ✅ Applies `applyDepartAutoOutForMonth` — days after depart date show "OUT" |
| Payroll calculation (`GET /api/payroll`) | ❌ Does NOT apply `applyDepartAutoOutForMonth` — counts post-depart days as worked |
| Bulk actions (`PATCH /attendance/bulk-*`) | ❌ No validation — blindly writes "Attended" to all weekdays |

---

## 2. Validation Logic Requirements

### 2.1 Trigger Conditions

The validation prompt must trigger when ALL of the following are true:

1. The action is a bulk attendance operation:
   - `PATCH /attendance/bulk-agent-month` (single agent, full month)
   - `PATCH /attendance/bulk-weekdays` (multiple agents, full month)
2. The requested status is `"Attended"` (or any working status that would count toward payroll)
3. The target employee(s) have a `depart_date` within the target month
4. The bulk action would overwrite days after the `depart_date`

### 2.2 Warning Message

The confirmation dialog must display:

```
"Warning: [Employee Name] has an Out Date on [depart_date].
Bulk marking attendance will overwrite days after the Out Date.
This may affect payroll calculations. Continue?"
```

For bulk operations affecting multiple employees with Out Dates:

```
"Warning: [N] employees have Out Dates in [month].
Bulk marking attendance will overwrite days after their Out Dates.
This may affect payroll calculations. Continue?"
```

### 2.3 Backend Validation Rules

The backend must enforce the same validation regardless of frontend behavior:

1. **Check for depart_date overlap**: For each employee being updated, check if `depart_date` falls within the target month
2. **Calculate affected days**: Count how many days after `depart_date` would be overwritten
3. **Reject or warn**: Return a `409 Conflict` response with details if the operation would overwrite post-depart days
4. **Force override flag**: Accept an optional `force: true` flag in the request body to bypass validation (for Raymond or admin override)

### 2.4 Raymond Exception

User `"Raymond"` (case-insensitive comparison on `req.username`) receives the following exceptions:

1. **Bulk actions**: No validation prompt — can mark attendance for full month even with Out Date present
2. **Revert to blank status**: Can set attendance records to empty/null status (`""`) for days after depart date, effectively "clearing" them
3. **Override header**: Backend recognizes `X-Raymond-Override: true` as an alternative bypass mechanism

---

## 3. Logic Flow

### 3.1 Frontend Flow

```
User clicks "Mark all weekdays as Attended"
    │
    ▼
Check if user is "Raymond"
    │
    ├─ YES → Proceed directly to API call
    │
    └─ NO → Check selected employees for depart_date in target month
              │
              ├─ NO employees with depart_date → Proceed with standard confirmation
              │
              └─ Employees with depart_date found
                    │
                    ▼
              Show enhanced confirmation dialog:
              "Warning: [N] employees have Out Dates..."
              [Cancel] [Continue Anyway]
                    │
                    ├─ Cancel → Abort operation
                    └─ Continue → Add force flag and proceed to API
```

### 3.2 Backend Flow

```
Receive PATCH /attendance/bulk-agent-month or bulk-weekdays
    │
    ▼
Validate request (permission, month locked, etc.)
    │
    ▼
Extract employee IDs and target month from request
    │
    ▼
For each employee:
    │
    ├─ Get employee record (depart_date)
    │
    ├─ Is username "Raymond"? (case-insensitive)
    │   │
    │   ├─ YES → Skip validation, allow any status including ""
    │   │
    │   └─ NO → Continue validation
    │         │
    │         ▼
    │         Does depart_date fall in target month?
    │         │
    │         ├─ NO → Allow operation
    │         │
    │         └─ YES → Would status be "Attended"?
    │               │
    │               ├─ NO → Allow operation
    │               │
    │               └─ YES → REJECT with 409 Conflict
    │                     Message: "Employee has Out Date on [date]..."
    │
    ▼
If all validations pass:
    │
    ├─ Apply depart auto-OUT for all affected employees
    │   (ensure days after depart_date are marked "OUT")
    │
    └─ Save attendance batch
    │
    ▼
Return { ok: true, count: N }
```

---

## 4. UI/UX Implementation

### 4.1 Enhanced Confirmation Modal

Replace the standard `confirm()` dialog with a styled modal that includes:

| Element | Description |
|---------|-------------|
| Icon | Warning triangle (⚠) |
| Title | "Out Date Conflict" |
| Message | Lists affected employees and their Out Dates |
| Detail | "Days after the Out Date will be marked as OUT automatically, but bulk Attended will overwrite them first." |
| Buttons | [Cancel] [Proceed Anyway] |
| Checkbox | "Don't warn me again this session" (optional) |

### 4.2 Bulk Weekdays Dialog Enhancement

For `bulk-weekdays`, the existing confirmation should be enhanced:

```
Current: "Mark all visible weekday cells as Attended?"
New:     "Mark all visible weekday cells as Attended?
          Warning: 3 employees have Out Dates in July 2026.
          Days after Out Date will be overwritten."
```

### 4.3 Single Agent Month Dialog Enhancement

For `bulk-agent-month`, the existing confirmation should be enhanced:

```
Current: "Mark all weekdays in July 2026 as Attended for HS1-12?"
New:     "Mark all weekdays in July 2026 as Attended for HS1-12?
          ⚠ Warning: HS1-12 has an Out Date on 2026-07-17.
          Days after July 17 will be overwritten."
```

### 4.4 Visual Indicator in Employee Selector

When an employee with an Out Date is selected for bulk action:
- Show a warning badge next to their name
- Tooltip: "Has Out Date on [date] — bulk actions will affect post-depart days"

---

## 5. Backend Validation Rules

### 5.1 New Middleware Function

```javascript
// lib/attendance-validation.js
function validateBulkAttendanceAgainstDepartDate(employees, month, status, username) {
  const isRaymond = String(username || "").toLowerCase() === "raymond";
  if (isRaymond) return { allowed: true, raymondOverride: true };

  const conflicts = [];
  for (const emp of employees) {
    const depart = String(emp.depart_date || "").slice(0, 10);
    if (!depart) continue;
    if (!String(depart).startsWith(month)) continue;
    
    const departDay = new Date(depart);
    const [year, mo] = month.split("-").map(Number);
    const daysInMonth = new Date(year, mo, 0).getDate();
    
    // Count days after depart date that would be overwritten
    const departDayNum = parseInt(depart.slice(8, 10), 10);
    const affectedDays = daysInMonth - departDayNum;
    
    if (affectedDays > 0 && status === "Attended") {
      conflicts.push({
        employeeId: emp.id,
        name: employeeDisplayName(emp),
        depart_date: depart,
        affectedDays,
      });
    }
  }

  return {
    allowed: conflicts.length === 0,
    conflicts,
    message: conflicts.length > 0
      ? `${conflicts.length} employee(s) have Out Dates in ${month}. ` +
        `Bulk marking as Attended will overwrite ${conflicts.reduce((s, c) => s + c.affectedDays, 0)} days after Out Dates.`
      : null,
  };
}
```

### 5.2 Route Handler Updates

**`PATCH /attendance/bulk-agent-month`**:
```javascript
router.patch("/attendance/bulk-agent-month", async (req, res) => {
  // ... existing permission checks ...
  
  const emp = store.getEmployeeById(employeeId);
  const validation = validateBulkAttendanceAgainstDepartDate([emp], month, status, req.username);
  
  if (!validation.allowed && !req.body.force) {
    return res.status(409).json({ 
      error: "depart_date_conflict",
      message: validation.message,
      conflicts: validation.conflicts,
    });
  }
  
  // ... existing logic ...
});
```

**`PATCH /attendance/bulk-weekdays`**:
```javascript
router.patch("/attendance/bulk-weekdays", async (req, res) => {
  // ... existing permission checks ...
  
  const validation = validateBulkAttendanceAgainstDepartDate(employees, month, status, req.username);
  
  if (!validation.allowed && !req.body.force) {
    return res.status(409).json({ 
      error: "depart_date_conflict",
      message: validation.message,
      conflicts: validation.conflicts,
    });
  }
  
  // ... existing logic ...
});
```

### 5.3 Payroll Calculation Fix

The core payroll bug must be fixed by applying `applyDepartAutoOutForMonth` in `buildEnrichedPayrollForMonth`:

```javascript
// routes/api.js - buildEnrichedPayrollForMonth
async function buildEnrichedPayrollForMonth(month, req, { unit = "", hideOut } = {}) {
  // ... existing employee/record loading ...
  
  const records = store.getAttendanceEvents(month);
  
  // NEW: Apply depart auto-OUT before building payroll summaries
  records = applyDepartAutoOutForMonth(employees, records, month);
  
  // ... rest of payroll building ...
}
```

---

## 6. Implementation Checklist

| # | Task | File(s) | Priority |
|---|------|---------|----------|
| 1 | Fix payroll calculation to apply depart auto-OUT | `routes/api.js` | Critical |
| 2 | Add backend validation middleware | `lib/attendance-validation.js` | High |
| 3 | Update `bulk-agent-month` route with validation | `routes/api.js` | High |
| 4 | Update `bulk-weekdays` route with validation | `routes/api.js` | High |
| 5 | Add frontend enhanced confirmation for `bulk-agent-month` | `public/js/app.js` | High |
| 6 | Add frontend enhanced confirmation for `bulk-weekdays` | `public/js/app.js` | High |
| 7 | Implement Raymond exception in frontend | `public/js/app.js` | Medium |
| 8 | Add visual indicator for employees with Out Date | `public/js/app.js` | Low |
| 9 | Write tests for validation logic | `test/` | Medium |
| 10 | Update CHANGELOG | `CHANGELOG.md` | Low |

---

## 7. Testing Scenarios

### 7.1 Standard User — Should Block

| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Agent with Out Date, bulk Attended | HS1-12, depart 2026-07-17, bulk Attended July | 409 Conflict |
| Agent without Out Date, bulk Attended | HS1-05, no depart, bulk Attended July | Success |
| Multiple agents, some with Out Dates | Mixed, bulk Attended July | 409 Conflict with affected list |

### 7.2 Raymond User — Should Allow

| Scenario | Input | Expected Result |
|----------|-------|-----------------|
| Raymond, agent with Out Date, bulk Attended | Raymond, HS1-12, depart 2026-07-17 | Success |
| Raymond, revert to blank status | Raymond, any employee, status "" | Success |
| Raymond, force flag not required | Raymond, any scenario | Proceed without force |

### 7.3 Payroll Accuracy

| Scenario | Expected Payroll workingDays |
|----------|------------------------------|
| Agent with depart 2026-07-17, 22 attended before, bulk Attended full month | 17 (not 22) |
| Agent without depart date, bulk Attended full month (23 working days) | 23 |
| Agent with depart, manual correct entry | Accurate count based on actual attendance |

---

## 8. Security Considerations

1. **Raymond exception is username-based**: Ensure `req.username` cannot be spoofed (it comes from session/auth middleware)
2. **Force flag**: Only allow `force: true` when user is Raymond or has admin/HR role
3. **Audit logging**: Log all bulk attendance operations with the validation outcome
4. **Rate limiting**: Consider rate limiting bulk operations to prevent abuse

---

## 9. Migration Notes

- No database schema changes required
- Existing attendance records are not affected
- The payroll fix changes calculation results for agents with Out Dates — payroll reports for affected months should be re-generated
- Consider adding a migration script to re-calculate payroll for July 2026 agents with Out Dates
