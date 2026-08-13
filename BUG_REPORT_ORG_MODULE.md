# Hangup HR — Bug Report & Risk Assessment
**Date:** 2026-07-18  
**Prepared for:** Raymond Walker  
**Scope:** Multi-company org module, rules engine, UI/UX, permissions  

---

## Executive Summary

Six issues were reported across organization management, rules configuration, UI/UX, and maintenance. Investigation reveals that **Issues 1, 2, 3, and 6 share a single root cause**: the company-context resolver for scoped users (OP/TL) does not auto-detect the user's unit company, causing HS-2 data to be hidden and Main Hangup data to leak into the HS-2 view. Issue 4 is an independent UI event-handling bug. Issue 5 is a maintenance risk with no immediate functional impact.

| ID | Type | Severity | Status |
|----|------|----------|--------|
| 1 | Bug | HIGH | Root cause identified |
| 2 | Bug | HIGH | Root cause identified |
| 3 | Bug | MEDIUM | Consequence of Issue 2 |
| 4 | Bug | MEDIUM | Independent UI bug |
| 5 | Risk | LOW | No functional impact |
| 6 | Bug | HIGH | Frontend filter strips OP's own unit |

---

## Issue 1 — Data Segregation: HS3 Requests Visible to MG2 in Main Hangup

**Type:** Bug  
**Severity:** HIGH  
**Affected Users:** MG2 (OP), any HS-2 scoped user (OP/TL/agent)  
**Affected Modules:** IT Requests, Meeting Requests, Employees, Attendance, all list views  

### Observed Behavior
When logged in as MG2 (an OP assigned to HS-2), the application displays Main Hangup (HS-1/HS-3) requests and employee data instead of HS-2 data. HS-2 data is completely absent from the view.

### Root Cause
`lib/company-context.js:138-143` — `resolveCompanyContextForUser()` does not fall back to the user's unit company for scoped users:

```js
function resolveCompanyContextForUser(value, userRole) {
  const company = parseCompanyContext(value);   // "" → "hangup"
  if (company !== "hs2") return company;          // Returns "hangup" immediately
  // getCompanyForUser() is NEVER called for non-managers
}
```

The frontend only appends `?company=hs2` when `canManageHs2Company()` is true (`app.js:129`). For an OP, this query param is absent. `parseCompany("")` returns `"hangup"`, so the function returns `"hangup"` without checking the user's unit.

Downstream, `filterEmployeesByCompany(employees, "hangup")` (`company-context.js:89-97`) runs:
```js
return list.filter((e) => !isHiddenInHangupDefault(e));
```
This **hides all HS-2 employees** (`isHiddenInHangupDefault` → `isInHs2Scope`) and **shows all Main Hangup employees** — the exact opposite of what the OP needs.

### Expected Behavior
An HS-2 OP should see only HS-2 scoped data. HS-2 requests/employees visible; HS-1/HS-3 hidden.

### Fix Required
Make `resolveCompanyContextForUser` mirror `resolveCompanyContextForRequest` by falling back to `getCompanyForUser(userRole)`:

```js
function resolveCompanyContextForUser(value, userRole) {
  const company = parseCompanyContext(value);
  if (company === "hs2") {
    const roles = require("./roles");
    return roles.canManageHs2Company(userRole) ? "hs2" : "hangup";
  }
  const co = getCompanyForUser(userRole);   // ADD THIS
  if (co && co !== "hangup") return co;
  return "hangup";
}
```

---

## Issue 2 — Rule Configuration Error: HS3 Rules Displayed Instead of HS2

**Type:** Bug  
**Severity:** HIGH  
**Affected Users:** HS-2 OP, TL, agent viewing rules  
**Affected Modules:** Rules page  

### Observed Behavior
When an HS-2 user (including MG2 OP) navigates to the Rules page, the system displays "HS3 Rules" (Main Hangup rules) instead of "HS2 Rules".

### Root Cause
`public/js/app.js:6903-6915` — `activeCompany` is computed incorrectly for scoped users:

```js
let activeCompany = state.rulesActiveCompany || "hangup";
const userUnit = state.user?.unit || "";
const isUserHs2 = userUnit === "HS-2" || userUnit === "HS2-PT";

const canAccessHs2 = state.user?.canManageHs2Company === true 
  || state.user?.canEditRules === true 
  || state.user?.role === "quality";
if (!showBothTabs) {
  activeCompany = (state.companyContext === "hs2" || isUserHs2) && canAccessHs2 ? "hs2" : "hangup";
}
```

For an HS-2 OP:
- `state.companyContext` defaults to `"hangup"` (never switched for non-managers)
- `isUserHs2` → `true` (unit is "HS-2")
- `canAccessHs2` → `false` (OP is not admin/ceo/hr/quality)
- Result: `(true && false) ? "hs2" : "hangup"` → **`"hangup"`**

The API call then fetches wrong-company rules:
```js
const data = await api(`/rules-content?company=${activeCompany}`); // company=hangup
```

### Expected Behavior
An HS-2 user should see HS2 rules. The rules tab should display the correct company's configuration.

### Fix Required
For scoped HS-2 users, derive `activeCompany` from the user's unit:

```js
if (!showBothTabs) {
  const isHs2ByUnit = userUnit === "HS-2" || userUnit === "HS2-PT";
  activeCompany = (state.companyContext === "hs2" || isHs2ByUnit) ? "hs2" : "hangup";
}
```

---

## Issue 3 — Rule Management Error on Edit

**Type:** Bug  
**Severity:** MEDIUM  
**Affected Users:** HS-2 HR/OP attempting rule edits  
**Affected Modules:** Rules management  

### Observed Behavior
When attempting to edit rules, an error occurs or the edit applies to the wrong company's rules.

### Root Cause
This is a **consequence of Issue 2**. The rule edit path (`app.js:6988-7004`) sends:

```js
await api(`/rules-content/${encodeURIComponent(sectionKey)}`, {
  method: "PUT",
  body: JSON.stringify({ company: activeCompany, content }),
});
```

Because `activeCompany` is `"hangup"` for non-manager HS-2 users (Issue 2 bug), the PUT body sends `company: "hangup"`. The backend (`routes/api.js:4041-4056`) trusts this value:

```js
const company = req.body.company || "hangup";
const section = await rulesRepo.upsertRulesContent(company, sectionKey, req.body, req.username);
```

Result: The edit "succeeds" but writes to the **wrong company's rules row**. For an OP, `canEditRules` returns false, so they get a 403 (correct behavior). For an HS-2 HR user who is not `canManageHs2Company`, the edit silently corrupts Main Hangup rules.

### Expected Behavior
Rule edits should save to the company the user is actually viewing.

### Fix Required
Same root fix as Issue 2 — correct `activeCompany` computation. Optionally add server-side validation:

```js
const effectiveCompany = getCompanyForUser(req.userRole) || req.body.company || "hangup";
```

---

## Issue 4 — Dropdown Closes Prematurely on Scroll/Click

**Type:** Bug  
**Severity:** MEDIUM  
**Affected Users:** All users  
**Affected Modules:** All dropdowns (Team/Unit selectors, status pickers, modals)  

### Observed Behavior
When attempting to scroll through a Team or Unit dropdown, the dropdown closes automatically before the user can make a selection. The dropdown also closes if the user scrolls the page/table behind it.

### Root Cause
`public/js/app.js:2065-2078` — The popover close handler has two bugs:

**Bug A — `mousedown` capture listener:**
```js
const onDoc = (e) => {
  if (el.contains(e.target) || anchor.contains(e.target)) return;
  closeActivePopover();
};
document.addEventListener("mousedown", onDoc, true);  // capture phase
```

The trigger opens on `click` (`app.js:2107`), but the outside-close listener is on `mousedown` (a different event). The `click` handler calls `e.stopPropagation()`, but that does **not** stop the `mousedown` capture listener. The open/close state depends on a fragile `setTimeout(…,0)` ordering.

**Bug B — scroll closes popover:**
```js
const onScroll = () => { closeActivePopover(); };
window.addEventListener("scroll", onScroll, true);  // capture phase
```

Any scroll event (including background table/grid scroll) immediately closes all open popovers. This is the classic "dropdown closes when scrolling list" bug.

### Expected Behavior
Dropdown should stay open while scrolling its own content or the page behind it. It should close only on explicit outside-click or Escape key.

### Fix Required
1. Change the outside-close listener from `mousedown` to `click`, or guard with an "ignore opening interaction" flag.
2. Remove or conditionally disable the `onScroll` handler for `position: fixed` popovers.

---

## Issue 5 — NPM Packages Require Update

**Type:** Risk / Technical Debt  
**Severity:** LOW  
**Affected Users:** Developers, build pipeline  
**Affected Modules:** Dependencies  

### Observed Behavior
Multiple NPM packages have available updates. The `npm audit` output shows 16 vulnerabilities (4 moderate, 12 high).

### Risk Assessment
- **Security:** 12 high-severity vulnerabilities in dependencies could be exploited if the app processes untrusted input.
- **Compatibility:** Current `got@11.x` works, but Supabase JS client warns that Node.js 20 is deprecated; Node.js 22+ is recommended.
- **Build stability:** The `got@^11.9.0` version resolution error during build indicates lockfile drift.

### Recommended Action
- Run `npm audit fix` and review breaking changes.
- Update `electron` to latest stable (currently 33.4.11).
- Pin critical dependencies and regenerate `package-lock.json`.
- Schedule as a separate maintenance sprint; do not bundle with feature changes.

---

## Issue 6 — MG2 OP Cannot See Own Unit/Teams in Organization Page

**Type:** Bug  
**Severity:** HIGH  
**Affected Users:** MG2 OP, any HS-2 OP/TL  
**Affected Modules:** Organization page  

### Observed Behavior
An MG2 user assigned as OP to a unit within HS2 cannot see that unit or its teams in the Organization page. The org structure appears empty or shows only Main Hangup units.

### Root Cause
`public/js/hrms-features.js:510-514` — The frontend org-structure filter strips HS-2 units for any user without `canManageHs2Company`:

```js
const unitSections = (structure.units || [])
  .filter((section) => {
    if (typeof state !== "undefined" && state.user?.canManageHs2Company) return true;
    return !companyCtx.isHs2Unit(section.unit);  // HS-2 removed for EVERYONE else
  })
```

The **backend actually returns the OP's HS-2 unit correctly**:
- `routes/hrms.js:24-40` calls `filterOrgStructureForRole()` for scoped users
- `lib/hrms-repo.js:1075-1083` keeps the OP's own unit:
  ```js
  if (role === "op") {
    const units = mapTeamsFiltered(
      (structure.units || []).filter((u) => u.unit === unit)  // keeps OP's unit
    );
  }
  ```

But the **frontend discards it** at line 513 before rendering.

### Expected Behavior
An HS-2 OP should see their own HS-2 unit, its teams, agents, and OP/TL chips.

### Fix Required
Allow a scoped HS-2 user to keep their own unit:

```js
.filter((section) => {
  if (state.user?.canManageHs2Company) return true;
  if (section.unit === state.user?.unit) return true;   // keep OP's own unit
  return !companyCtx.isHs2Unit(section.unit);
})
```

---

## Cross-Cutting Root Cause Analysis

The systemic defect is in **`lib/company-context.js:138-143`** (`resolveCompanyContextForUser`). Unlike its sibling `resolveCompanyContextForRequest` (which correctly falls back to `getCompanyForUser` for scoped users), this function returns `"hangup"` for any non-manager HS-2 user.

This single bug cascades into:
- **Issue 1:** Wrong company context → wrong employee/request visibility
- **Issue 2:** Wrong `activeCompany` → wrong rules displayed
- **Issue 3:** Wrong `activeCompany` → rule edits written to wrong company
- **Issue 6:** Wrong company context → frontend filters out OP's own unit

### Recommended Fix Priority

| Priority | Fix | Files to Modify |
|----------|-----|-----------------|
| P0 | Fix `resolveCompanyContextForUser` to use `getCompanyForUser` fallback | `lib/company-context.js:138-143` |
| P1 | Fix `activeCompany` computation in rules page | `public/js/app.js:6903-6915` |
| P1 | Fix org page unit filter to keep OP's own unit | `public/js/hrms-features.js:510-514` |
| P2 | Fix dropdown scroll/mousedown bug | `public/js/app.js:2065-2078` |
| P3 | NPM audit and dependency updates | `package.json`, `package-lock.json` |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Data leakage between companies | HIGH | HIGH | Fix `resolveCompanyContextForUser` (P0) |
| Rule corruption (wrong company edits) | MEDIUM | HIGH | Fix `activeCompany` (P1) + server-side validation |
| OP/TL unable to work in org module | HIGH | HIGH | Fix frontend unit filter (P1) |
| UI dropdown friction | MEDIUM | MEDIUM | Fix event handlers (P2) |
| Dependency vulnerabilities | MEDIUM | LOW | Run `npm audit fix` (P3) |
| Build failures (got version mismatch) | LOW | MEDIUM | Regenerate lockfile (P3) |

---

## Appendix: Files Referenced

| File | Issues |
|------|--------|
| `lib/company-context.js` | 1, 2, 3, 6 |
| `lib/roles.js` | 1, 2, 3 |
| `lib/hrms-repo.js` | 6 |
| `routes/api.js` | 2, 3 |
| `routes/hrms.js` | 6 |
| `public/js/app.js` | 2, 3, 4 |
| `public/js/hrms-features.js` | 6 |
