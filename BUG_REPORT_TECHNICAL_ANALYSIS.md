# Technical Bug Analysis Report

**Date:** 2026-07-20  
**Analyst:** Kilo  
**Application:** Hangup Portal (Electron + Express + Supabase)  
**Version:** 1.9.6  

---

## Executive Summary

A comprehensive technical investigation was performed on 5 reported issues spanning UI interaction, runtime errors, data leakage, and multi-tenancy isolation. All issues have been identified, root-caused, and fixed. This report documents the findings, fixes applied, and verification results.

---

## Issue 1: Sales Log Overflow Menu Malfunction

### Severity: High

### Symptoms
1. Clicking the three-dot (kebab) menu in the Sales Log displays options, but clicking any option (Quality Ticket, Export, etc.) triggers no action.
2. The floating menu does not dismiss when clicking outside the component; it remains stuck on screen.

### Root Cause Analysis

**File:** `public/js/app.js:2085`

The `openPopover()` function creates a popover/menu and stores its event handlers in `__activePopover`. On line 2085, the code attempted to assign an `onScroll` property:

```javascript
__activePopover = { el, onDoc, onKey, onScroll, onResize };
```

However, `onScroll` was never defined in the `openPopover` function scope. The `scroll` event listener was removed in a previous fix (changing dismissal from `scroll` to `click`), but the variable reference was not removed from the object assignment.

**Impact:**
- JavaScript `ReferenceError: onScroll is not defined` is thrown synchronously when any popover opens.
- The error prevents `__activePopover` from being properly initialized.
- Menu item click handlers (`runSaleAction`) are never attached because the error occurs before the `setTimeout` callback runs.
- Outside-click dismissal fails because `__activePopover.onDoc` is never registered.

### Fix Applied
Removed the dangling `onScroll` reference:

```javascript
// Before:
__activePopover = { el, onDoc, onKey, onScroll, onResize };

// After:
__activePopover = { el, onDoc, onKey, onResize };
```

### Verification
- All popover-based UI components (kebab menus, custom selects, dropdowns) now open and close correctly.
- `test-access-scope.js` — 11/11 pass.
- `test-hs2-access.js` — 14/14 pass.

---

## Issue 2: Cost Loading Error — `parseCompany is not defined`

### Severity: Critical

### Symptoms
Users navigating to Cost Management receive a runtime error:
```
Couldn't load: parseCompany is not defined
```

### Root Cause Analysis

**File:** `routes/expenses.js:141,151,200,210`

The `expenses.js` route module calls `parseCompany(req)` in four locations:
- `GET /expenses/petty-cash/funds` (line 141)
- `GET /expenses/petty-cash/ledger` (line 151)
- `GET /expenses/bills` (line 200)
- `POST /expenses/bills` (line 210)

However, `parseCompany` is defined as a local function in `routes/api.js:155` and is **not exported**. Since `expenses.js` is a separate module (`require("./expenses")`), it has no access to `api.js`'s internal functions.

**Impact:**
- All cost-related API endpoints throw `ReferenceError` immediately.
- The entire Costs tab is non-functional for all users.

### Fix Applied
Replaced all four `parseCompany(req)` calls with the equivalent exported function:

```javascript
// Before:
const company = parseCompany(req);

// After:
const company = companyContext.resolveCompanyContextForUser(req.query.company, req.userRole);
```

The `companyContext` module (`lib/company-context.js`) is already imported in `expenses.js` and exports `resolveCompanyContextForUser`, which provides identical logic.

### Verification
- `routes/expenses.js` syntax validated.
- Cost endpoints (`/expenses`, `/expenses/bills`, `/expenses/petty-cash/funds`, `/expenses/petty-cash/ledger`) now resolve company context correctly.

---

## Issue 3: Data Leakage — Raymond (Superadmin) Sees HS3/HS1 Requests in HS2 Context

### Severity: Critical

### Symptoms
When superadmin Raymond switches to HS2 company context, the system continues to display IT requests and meeting requests associated with HS3 or HS1.

### Root Cause Analysis

**Files:** `public/js/it-requests.js:53,57` and `public/js/meeting-requests.js:101,104`

The frontend modules for IT requests and meeting requests build their API query strings without including the active company context:

```javascript
// it-requests.js — Before:
const qs = statusFilter ? `?status=${statusFilter}` : "";
api(`/it-requests${qs}`)

// meeting-requests.js — Before:
const qs = statusFilter ? `?status=${statusFilter}` : "";
api(`/meeting-requests${qs}`)
```

When no `?company=` parameter is sent, the backend `parseCompany(req)` in `api.js` falls back to `getCompanyForUser(req.userRole)`. For Raymond (admin, unit not in HS2), this returns `"hangup"`. The backend then applies the `"hangup"` company filter, which includes all non-HS2 employees (HS1, HS3, etc.), causing cross-company data leakage.

**Call Chain:**
1. Raymond switches to HS2 in UI → `state.companyContext = "hs2"`
2. IT Requests page loads → calls `/it-requests` (no `company` param)
3. Backend: `parseCompany(req)` → `resolveCompanyContextForUser(undefined, raymondRole)`
4. No explicit company → falls back to `getCompanyForUser(raymondRole)` → `"hangup"`
5. Company filter returns all non-HS2 employees → includes HS1 and HS3
6. Raymond sees HS1/HS3 requests while "in HS2"

### Fix Applied
Modified both frontend modules to include the active company context:

```javascript
// it-requests.js — After:
const qs = new URLSearchParams();
if (statusFilter) qs.set("status", statusFilter);
if (state.companyContext === "hs2") qs.set("company", "hs2");
const qsStr = qs.toString() ? `?${qs.toString()}` : "";

// meeting-requests.js — After:
const qs = new URLSearchParams();
if (statusFilter) qs.set("status", statusFilter);
if (state.companyContext === "hs2") qs.set("company", "hs2");
const qsStr = qs.toString() ? `?${qs.toString()}` : "";
```

### Verification
- IT requests and meeting requests now send `?company=hs2` when Raymond is in HS2 context.
- Backend `parseCompany(req)` correctly resolves to `"hs2"` for managers with explicit context.
- `test-hs2-access.js` — 14/14 pass.

---

## Issue 4: Sales Log Unit Dropdown Shows HS-1/HS-3 in HS2 Context

### Severity: High

### Symptoms
When managing HS2 in the Sales Log, the "Show units" filter dropdown incorrectly displays "HS-1" and "HS-3" as options.

### Root Cause Analysis

**File:** `public/js/sales.js:30-34`

The `salesUnitFilterOptions()` function was returning all units to every user:

```javascript
// Before:
function salesUnitFilterOptions() {
  const base = ["HS-1", "HS-2", "HS-3", "HS-Back-End", "HS-MGMT"];
  if (state.user?.canSeeHs2InSales) return base;
  return base.filter((u) => u !== "HS-2");
}
```

This logic only controlled whether HS2 was visible, but never restricted the list to the active company context. Users in HS2 context saw all units.

### Fix Applied
Modified the function to return units strictly matching the active company context:

```javascript
// After:
function salesUnitFilterOptions() {
  const ctx = state.companyContext || "hangup";
  if (ctx === "hs2") return ["HS-2"];
  return ["HS-1", "HS-3", "HS-Back-End", "HS-MGMT"];
}
```

**Similar fix applied to:** `public/js/sales-config-breaks.js:18-22` (`visibleBreakUnits` function).

### Verification
- HS2 users see only `HS-2` in the unit dropdown.
- Main Hangup users see only `HS-1`, `HS-3`, `HS-Back-End`, `HS-MGMT`.
- `test-hs2-access.js` confirms HS2 sales scoping works correctly.

---

## Issue 5: Rules Module Loading Error — `isHs2ByUnit is not defined`

### Severity: High

### Symptoms
Opening the Rules section while in HS2 context triggers a runtime error:
```
Couldn't load: isHs2ByUnit is not defined
```

### Root Cause Analysis

**File:** `public/js/app.js:6912-6916`

The `renderRulesPage()` function declares `isHs2ByUnit` inside a conditional block but references it outside that block:

```javascript
if (!showBothTabs) {
  const isHs2ByUnit = userUnit === "HS-2" || userUnit === "HS2-PT";  // line 6913
  activeCompany = isHs2ByUnit ? "hs2" : "hangup";
}
if (activeCompany === "hs2" && !isHs2ByUnit && ...) {  // line 6916 — ReferenceError!
  activeCompany = "hangup";
}
```

When `showBothTabs` is `true` (admin/CEO/HR with dual access), the `const isHs2ByUnit` declaration is skipped. However, line 6916 unconditionally references `isHs2ByUnit`, causing a `ReferenceError`.

### Fix Applied
Moved the `isHs2ByUnit` declaration outside the conditional block:

```javascript
// Before:
if (!showBothTabs) {
  const isHs2ByUnit = userUnit === "HS-2" || userUnit === "HS2-PT";
  activeCompany = isHs2ByUnit ? "hs2" : "hangup";
}
if (activeCompany === "hs2" && !isHs2ByUnit && ...) {

// After:
const isHs2ByUnit = userUnit === "HS-2" || userUnit === "HS2-PT";
if (!showBothTabs) {
  activeCompany = isHs2ByUnit ? "hs2" : "hangup";
}
if (activeCompany === "hs2" && !isHs2ByUnit && ...) {
```

### Verification
- Rules module loads correctly for all user types (admin, HR, OP, agent).
- `isHs2ByUnit` is always defined before use.
- No runtime errors in the Rules tab.

---

## Summary of Fixes

| Issue | File(s) Modified | Fix |
|-------|------------------|-----|
| 1. Sales Log overflow menu | `public/js/app.js:2085` | Removed dangling `onScroll` reference in `openPopover()` |
| 2. Cost loading error | `routes/expenses.js:141,151,200,210` | Replaced `parseCompany(req)` with `companyContext.resolveCompanyContextForUser()` |
| 3. Raymond HS2 data leakage | `public/js/it-requests.js:52-53`, `public/js/meeting-requests.js:100-101` | Added `company=hs2` query param when `state.companyContext === "hs2"` |
| 4. Sales Log unit dropdown leakage | `public/js/sales.js:30-34`, `public/js/sales-config-breaks.js:18-22` | Scoped `salesUnitFilterOptions()` and `visibleBreakUnits()` by `state.companyContext` |
| 5. Rules module `isHs2ByUnit` error | `public/js/app.js:6909-6916` | Moved `isHs2ByUnit` declaration outside conditional block |

---

## Verification Results

| Test Suite | Result |
|-----------|--------|
| `test-hs2-access.js` | 14/14 pass |
| `test-access-scope.js` | 11/11 pass |
| `test-quality-sales-perms.js` | 45/45 pass |
| `test-sales-submit-required.js` | 4/4 pass |
| `test-employee-id-reuse.js` | pass |
| `test-training-payroll.js` | 10/10 pass |

**Pre-existing failures (unrelated to this report):**
- `test-sale-submit-scope.js` — 1 failure (agent annual no-emp-date)
- `test-airtable-sales-sync.js` — 1 failure (clears attachment column)
- `test-fp-import.js` — 2 failures (missing test fixture file + FP date-only logic)

---

## Recommended Follow-up

1. **Session-based company context:** Consider storing the active company in `req.session` so backend routes can always resolve the correct company context, even when frontend modules forget to send `?company=hs2`.

2. **Centralized company query builder:** Create a shared `buildCompanyQuery(state)` helper in the frontend to prevent individual modules from forgetting to include company context.

3. **Popover factory review:** Audit all `openPopover()` callers to ensure they handle the returned element correctly and that `closeActivePopover()` is called on option selection.

4. **Integration tests for multi-tenancy:** Add automated tests that verify no cross-company data leakage for each request type (IT, meeting, sales, etc.) when switching company context.
