# Leave Request Management

<cite>
**Referenced Files in This Document**
- [routes/hrms.js](file://routes/hrms.js)
- [lib/hrms-repo.js](file://lib/hrms-repo.js)
- [lib/leave-attendance.js](file://lib/leave-attendance.js)
- [lib/request-rules.js](file://lib/request-rules.js)
- [public/js/requests.js](file://public/js/requests.js)
- [lib/calendar.js](file://lib/calendar.js)
- [lib/roles.js](file://lib/roles.js)
- [lib/attendance.js](file://lib/attendance.js)
- [routes/api.js](file://routes/api.js)
- [supabase/migrations/20260724_v132_it_flag_unit_finance.sql](file://supabase/migrations/20260724_v132_it_flag_unit_finance.sql)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document explains the Leave Request Management feature set, including leave types, approval workflows, calendar integration, and automatic attendance updates. It covers the full lifecycle from submission to approval/rejection, working day calculations, holiday calendar integration, leave balance tracking implications, and reporting considerations. Practical examples illustrate calculation logic, routing rules, and compliance enforcement.

## Project Structure
Leave management spans routes, repository access, validation rules, UI, and calendar utilities:
- Routes expose REST endpoints for listing, creating, updating, deleting requests and documents.
- Repository layer persists requests and holidays via Supabase.
- Validation rules enforce policy (eligibility, fractions, same-day cutoffs).
- Attendance integration maps approved leaves to daily attendance records.
- Calendar utilities provide weekend/holiday detection and month scaffolding.
- Frontend renders request forms, badges, and actions.

```mermaid
graph TB
subgraph "Frontend"
UI["public/js/requests.js"]
end
subgraph "API Layer"
HRMS["routes/hrms.js"]
API["routes/api.js"]
end
subgraph "Business Logic"
RULES["lib/request-rules.js"]
ATTMAP["lib/leave-attendance.js"]
CALENDAR["lib/calendar.js"]
ROLES["lib/roles.js"]
end
subgraph "Persistence"
REPO["lib/hrms-repo.js"]
DB["Supabase Tables<br/>leave_requests, public_holidays,<br/>leave_request_documents"]
end
UI --> HRMS
HRMS --> RULES
HRMS --> ATTMAP
HRMS --> REPO
HRMS --> ROLES
HRMS --> DB
API --> CALENDAR
API --> REPO
```

**Diagram sources**
- [routes/hrms.js:526-719](file://routes/hrms.js#L526-L719)
- [lib/hrms-repo.js:687-841](file://lib/hrms-repo.js#L687-L841)
- [lib/leave-attendance.js:1-77](file://lib/leave-attendance.js#L1-L77)
- [lib/request-rules.js:1-153](file://lib/request-rules.js#L1-L153)
- [lib/calendar.js:1-94](file://lib/calendar.js#L1-L94)
- [lib/roles.js:180-192](file://lib/roles.js#L180-L192)
- [routes/api.js:2391-2416](file://routes/api.js#L2391-L2416)

**Section sources**
- [routes/hrms.js:526-719](file://routes/hrms.js#L526-L719)
- [lib/hrms-repo.js:687-841](file://lib/hrms-repo.js#L687-L841)
- [lib/leave-attendance.js:1-77](file://lib/leave-attendance.js#L1-L77)
- [lib/request-rules.js:1-153](file://lib/request-rules.js#L1-L153)
- [lib/calendar.js:1-94](file://lib/calendar.js#L1-L94)
- [lib/roles.js:180-192](file://lib/roles.js#L180-L192)
- [routes/api.js:2391-2416](file://routes/api.js#L2391-L2416)

## Core Components
- Leave request CRUD and approvals:
  - List/create/update/delete leave requests with audit notifications and attendance sync on state changes.
- Policy and validation:
  - Enforces eligibility (e.g., annual leave after 180 days), fraction constraints, team scoping, and same-day cutoffs.
- Attendance mapping:
  - Converts approved requests into daily attendance rows with correct statuses and paid flags.
- Holiday calendar:
  - Reads active holidays by country; used to prefill or exclude dates in monthly views.
- Roles and permissions:
  - Approval is gated by role-based checks and named executive shortcuts.

**Section sources**
- [routes/hrms.js:526-719](file://routes/hrms.js#L526-L719)
- [lib/request-rules.js:1-153](file://lib/request-rules.js#L1-L153)
- [lib/leave-attendance.js:1-77](file://lib/leave-attendance.js#L1-L77)
- [lib/hrms-repo.js:687-841](file://lib/hrms-repo.js#L687-L841)
- [lib/calendar.js:1-94](file://lib/calendar.js#L1-L94)
- [lib/roles.js:180-192](file://lib/roles.js#L180-L192)

## Architecture Overview
The system follows a layered architecture:
- Client UI calls REST endpoints.
- Route handlers validate inputs, persist data, and orchestrate side effects (notifications, attendance updates).
- Repository functions abstract database operations.
- Utilities compute calendar-aware logic and map leave types to attendance statuses.

```mermaid
sequenceDiagram
participant U as "User"
participant FE as "Frontend (requests.js)"
participant RH as "Route Handler (hrms.js)"
participant RL as "Rules (request-rules.js)"
participant RP as "Repo (hrms-repo.js)"
participant LA as "Leave->Attendance (leave-attendance.js)"
participant ST as "Store (saveAttendanceBatch)"
participant DB as "Supabase"
U->>FE : Submit leave request
FE->>RH : POST /hrms/leave
RH->>RL : validateRequestSubmit(...)
RL-->>RH : validated payload
RH->>RP : createLeaveRequest(payload)
RP->>DB : INSERT leave_requests
DB-->>RP : created row
RP-->>RH : mapped request
RH->>ST : saveAttendanceBatch([]) // no-op until approved
RH-->>FE : 201 { ok, request }
U->>FE : Approve request
FE->>RH : PUT /hrms/leave/ : id { status : "approved" }
RH->>RP : updateLeaveRequest(id, patch)
RP->>DB : UPDATE leave_requests
DB-->>RP : updated row
RH->>LA : leaveAttendanceRecords(request)
LA-->>RH : attendance records
RH->>ST : saveAttendanceBatch(records)
RH-->>FE : 200 { ok, request }
```

**Diagram sources**
- [routes/hrms.js:538-636](file://routes/hrms.js#L538-L636)
- [lib/request-rules.js:53-140](file://lib/request-rules.js#L53-L140)
- [lib/hrms-repo.js:722-769](file://lib/hrms-repo.js#L722-L769)
- [lib/leave-attendance.js:11-61](file://lib/leave-attendance.js#L11-L61)

## Detailed Component Analysis

### Leave Types and Policy Enforcement
Supported kinds include annual (paid), unpaid, medical/sick, same-day off, and pause (full Mon–Fri week). Key policies:
- Annual leave requires employment_date and at least 180 days of service for non-HR roles.
- Half-day and quarter-day are allowed only for single-day requests.
- TL/OP can submit for their team members under specific kinds.
- Same-day submissions after a configured hour are flagged late.

```mermaid
flowchart TD
Start(["Submit Request"]) --> Kind{"Kind?"}
Kind --> |pause| Pause["Compute Mon–Fri bounds"]
Kind --> |annual| AnnualGate["Check employment_date & >= 180 days"]
Kind --> |other| OtherKinds["Validate kind-specific rules"]
AnnualGate --> Fractions["Validate dayFraction"]
Pause --> Fractions
OtherKinds --> Fractions
Fractions --> SingleDay{"fraction < 1 ?"}
SingleDay --> |Yes| SameDate{"startDate == endDate ?"}
SameDate --> |No| Error["Reject: half/quarter must be single-day"]
SameDate --> |Yes| LateCheck["Same-day cutoff?"]
LateCheck --> Result(["Return validated payload"])
SingleDay --> |No| LateCheck
```

**Diagram sources**
- [lib/request-rules.js:1-153](file://lib/request-rules.js#L1-L153)

**Section sources**
- [lib/request-rules.js:1-153](file://lib/request-rules.js#L1-L153)
- [public/js/requests.js:1-200](file://public/js/requests.js#L1-L200)

### Approval Workflow and Routing
- Only approvers (HR/Admin/CEO or named executives) can change status to approved/rejected or edit fields beyond status.
- On approval, attendance records are generated and saved automatically.
- On rejection or deletion of an approved request, previously written attendance records are cleared.

```mermaid
sequenceDiagram
participant A as "Approver"
participant FE as "Frontend"
participant RH as "Route Handler"
participant RL as "Roles"
participant RP as "Repo"
participant LA as "Leave->Attendance"
participant ST as "Store"
A->>FE : Click Approve/Reject/Edit/Delete
FE->>RH : PUT/DELETE /hrms/leave/ : id
RH->>RL : canApproveLeave(username, userRole)
RL-->>RH : true/false
alt Approved
RH->>RP : updateLeaveRequest(..., status=approved)
RH->>LA : leaveAttendanceRecords(request)
RH->>ST : saveAttendanceBatch(records)
else Rejected/Deleted (was approved)
RH->>RP : update/delete
RH->>LA : clearLeaveAttendanceRecords(prior)
RH->>ST : saveAttendanceBatch(clear-records)
end
RH-->>FE : Response
```

**Diagram sources**
- [routes/hrms.js:603-662](file://routes/hrms.js#L603-L662)
- [lib/roles.js:180-192](file://lib/roles.js#L180-L192)
- [lib/leave-attendance.js:63-71](file://lib/leave-attendance.js#L63-L71)

**Section sources**
- [routes/hrms.js:603-662](file://routes/hrms.js#L603-L662)
- [lib/roles.js:180-192](file://lib/roles.js#L180-L192)

### Working Day Calculations and Attendance Mapping
- Full-day or multi-day ranges produce one attendance record per date with status “Day-OFF”.
- Half-day sets “Half Day”; quarter-day sets “Quarter Day-Off” (single-day only).
- Pause requests generate “Day-OFF” only for weekdays within the range (Mon–Fri).
- Paid flag is true for annual leave or when explicitly marked paid.

```mermaid
flowchart TD
In(["Approved Request"]) --> Kind{"kind == 'pause' ?"}
Kind --> |Yes| Weekdays["Filter Mon–Fri in range"]
Kind --> |No| AllDays["All dates in range"]
Weekdays --> MapPA["Map to Day-OFF (paid=false)"]
AllDays --> Fraction{"dayFraction < 1 ?"}
Fraction --> |Yes| Single{"single-day?"}
Single --> |Yes| Status["Half Day or Quarter Day-Off"]
Single --> |No| Error["Invalid: fraction < 1 must be single-day"]
Fraction --> |No| MapDO["Map to Day-OFF (paid = annual or explicit)"]
MapPA --> Out(["Attendance Records"])
MapDO --> Out
Status --> Out
```

**Diagram sources**
- [lib/leave-attendance.js:11-61](file://lib/leave-attendance.js#L11-L61)

**Section sources**
- [lib/leave-attendance.js:1-77](file://lib/leave-attendance.js#L1-L77)
- [lib/attendance.js:69-97](file://lib/attendance.js#L69-L97)

### Calendar Integration and Holidays
- Active holidays are read by country and filtered by month.
- Monthly attendance initialization skips weekends and holidays, defaulting working days to “Attended”.
- The frontend displays grouped holidays and highlights them in the calendar view.

```mermaid
sequenceDiagram
participant FE as "Frontend"
participant API as "API (/api/...)"
participant HR as "Repo (hrms-repo.js)"
participant CAL as "Calendar (calendar.js)"
participant STORE as "Store"
FE->>API : Initialize month attendance
API->>HR : readPublicHolidays({activeOnly : true})
HR-->>API : holidays[]
API->>CAL : getMonthCalendar(month)
CAL-->>API : days[]
API->>STORE : saveAttendanceBatch(filtered records)
API-->>FE : ok + count
```

**Diagram sources**
- [routes/api.js:2391-2416](file://routes/api.js#L2391-L2416)
- [lib/hrms-repo.js:771-815](file://lib/hrms-repo.js#L771-L815)
- [lib/calendar.js:53-66](file://lib/calendar.js#L53-L66)

**Section sources**
- [routes/api.js:2391-2416](file://routes/api.js#L2391-L2416)
- [lib/hrms-repo.js:771-815](file://lib/hrms-repo.js#L771-L815)
- [lib/calendar.js:1-94](file://lib/calendar.js#L1-L94)
- [public/js/hrms-features.js:38-64](file://public/js/hrms-features.js#L38-L64)

### Leave Balance Tracking and Reporting
- Paid leave days are counted from attendance records where status is “Day-OFF” and paidLeave is true.
- Summaries aggregate attended days, paid leave, half-days, quarter-offs, lateness, and other statuses for payroll and reporting.
- Working days per month are computed from calendar utilities and may be overridden by configuration.

```mermaid
classDiagram
class AttendanceSummary {
+employeeId
+name
+unit
+email
+workingDays
+paidLeaveDays
+daysOff
+halfDays
+quarterOff
+lateness
+nsnc
+nsncHalf
+paused
+extraDays
+latenessDeductions
+latenessDetail
+aipNotes
}
class AttendanceRecord {
+employeeId
+date
+status
+paidLeave
+leaveNote
}
AttendanceSummary --> AttendanceRecord : "aggregates"
```

**Diagram sources**
- [lib/attendance.js:69-97](file://lib/attendance.js#L69-L97)

**Section sources**
- [lib/attendance.js:69-97](file://lib/attendance.js#L69-L97)
- [lib/calendar.js:28-30](file://lib/calendar.js#L28-L30)

### Compliance and Audit Trail
- Late same-day submissions trigger HR warnings.
- TL/OP-submitted requests are flagged for visibility.
- Edit and delete actions are audited with actor context.
- Documents attached to leave requests are stored and listed with RLS deny-all policy for safety.

**Section sources**
- [routes/hrms.js:570-662](file://routes/hrms.js#L570-L662)
- [supabase/migrations/20260724_v132_it_flag_unit_finance.sql:40-48](file://supabase/migrations/20260724_v132_it_flag_unit_finance.sql#L40-L48)

## Dependency Analysis
Key dependencies and coupling:
- Routes depend on repository, rules, roles, and attendance mapping.
- Repository depends on Supabase client and tables.
- Attendance mapping depends on request attributes and calendar weekday logic.
- Frontend depends on route responses and role flags to render controls.

```mermaid
graph LR
HRMS["routes/hrms.js"] --> RULES["lib/request-rules.js"]
HRMS --> REPO["lib/hrms-repo.js"]
HRMS --> ATT["lib/leave-attendance.js"]
HRMS --> ROLES["lib/roles.js"]
ATT --> CALENDAR["lib/calendar.js"]
API["routes/api.js"] --> REPO
API --> CALENDAR
UI["public/js/requests.js"] --> HRMS
```

**Diagram sources**
- [routes/hrms.js:526-719](file://routes/hrms.js#L526-L719)
- [lib/hrms-repo.js:687-841](file://lib/hrms-repo.js#L687-L841)
- [lib/leave-attendance.js:1-77](file://lib/leave-attendance.js#L1-L77)
- [lib/request-rules.js:1-153](file://lib/request-rules.js#L1-L153)
- [lib/calendar.js:1-94](file://lib/calendar.js#L1-L94)
- [routes/api.js:2391-2416](file://routes/api.js#L2391-L2416)
- [public/js/requests.js:1-200](file://public/js/requests.js#L1-L200)

**Section sources**
- [routes/hrms.js:526-719](file://routes/hrms.js#L526-L719)
- [lib/hrms-repo.js:687-841](file://lib/hrms-repo.js#L687-L841)
- [lib/leave-attendance.js:1-77](file://lib/leave-attendance.js#L1-L77)
- [lib/request-rules.js:1-153](file://lib/request-rules.js#L1-L153)
- [lib/calendar.js:1-94](file://lib/calendar.js#L1-L94)
- [routes/api.js:2391-2416](file://routes/api.js#L2391-L2416)
- [public/js/requests.js:1-200](file://public/js/requests.js#L1-L200)

## Performance Considerations
- Batch attendance writes: When approving or clearing leave, attendance records are batch-saved to minimize round-trips.
- Filtering on the server: Leave list supports filtering by employee and status to reduce payload size.
- Calendar generation: Month calendars are computed locally using lightweight date math; holidays are fetched once per month.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Approval denied: Ensure the user has approveLeave permission or is a named executive. Check role resolution and Access Control settings.
- Invalid fraction error: Half-day and quarter-day require a single-day range. Adjust start/end dates accordingly.
- Annual leave not available: Employee lacks employment_date or has fewer than 180 days of service. Update employee record or wait until eligible.
- Attendance not updated: Confirm the request was approved; attendance is only written on approval or cleared on rejection/deletion of an approved request.
- Holidays not reflected: Verify active holidays are seeded for the relevant country and month.

**Section sources**
- [lib/roles.js:180-192](file://lib/roles.js#L180-L192)
- [lib/request-rules.js:121-140](file://lib/request-rules.js#L121-L140)
- [routes/hrms.js:603-662](file://routes/hrms.js#L603-L662)
- [routes/api.js:2391-2416](file://routes/api.js#L2391-L2416)

## Conclusion
Leave Request Management integrates policy-driven validation, role-based approvals, and automatic attendance synchronization. Calendar-aware logic ensures accurate working day calculations and holiday handling. The design keeps concerns separated across routes, repository, rules, and utilities, enabling maintainability and extensibility for future enhancements such as advanced conflict detection and richer reporting.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### Practical Examples
- Leave calculation logic:
  - Annual leave for a single day with dayFraction=0.5 → “Half Day” attendance record, paid=true.
  - Pause request spanning Mon–Fri → five “Day-OFF” records, paid=false.
- Approval routing:
  - Non-approver attempts to set status → 403 forbidden.
  - Approver approves → attendance batch saved automatically.
- Reporting features:
  - Summaries include paidLeaveDays, halfDays, quarterOff, and workingDays for payroll computation.

**Section sources**
- [lib/leave-attendance.js:11-61](file://lib/leave-attendance.js#L11-L61)
- [routes/hrms.js:603-636](file://routes/hrms.js#L603-L636)
- [lib/attendance.js:69-97](file://lib/attendance.js#L69-L97)