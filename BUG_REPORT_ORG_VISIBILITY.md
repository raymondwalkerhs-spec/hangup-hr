# Bug Investigation Report — Organization Visibility & Superadmin Access

Date: 2026-07-20
Status: Fixed

---

## Bug 1: Organization Visibility Issue — User MG2 (HS2 OP)

### Symptom
User **MG2** (Operations Manager in HS2) cannot view any units within the Organization tab. The org structure appears empty or shows only Main Hangup units.

### Root Cause
`resolveCompanyContextForUser()` in `lib/company-context.js:138-147` was forcing all non-managers back to `"hangup"` when an explicit `?company=hs2` parameter was passed.

**Original code:**
```javascript
function resolveCompanyContextForUser(value, userRole) {
  const company = parseCompanyContext(value);
  if (company === "hs2") {
    const roles = require("./roles");
    return roles.canManageHs2Company(userRole) ? "hs2" : "hangup";
  }
  // ...
}
```

**Call chain:**
1. MG2 navigates to Organization → frontend calls `/hrms/org-structure?company=hs2`
2. Backend: `resolveCompanyContextForUser("hs2", mg2Role)`
3. `company = "hs2"`, `canManageHs2Company(mg2Role) = false` (OP cannot manage HS2)
4. Returns `"hangup"` instead of `"hs2"`
5. `GET /org-structure` receives `company = "hangup"`
6. Falls into `else if (company !== "hs2")` branch → filters OUT all HS2 units
7. MG2 sees empty org structure

### Fix Applied
Modified `resolveCompanyContextForUser()` to fall through to `getCompanyForUser()` when the user cannot manage HS2 but belongs to it:

```javascript
function resolveCompanyContextForUser(value, userRole) {
  const company = parseCompanyContext(value);
  if (company === "hs2") {
    const roles = require("./roles");
    if (roles.canManageHs2Company(userRole)) return "hs2";
    const co = getCompanyForUser(userRole);
    if (co && co !== "hangup") return co;
    return "hangup";
  }
  const co = getCompanyForUser(userRole);
  if (co && co !== "hangup") return co;
  return company || "hangup";
}
```

Now when MG2 (unit = `HS-2`) requests HS2:
1. `canManageHs2Company` → false
2. `getCompanyForUser(mg2Role)` → unit is `HS-2` → returns `"hs2"`
3. Returns `"hs2"` ✓
4. Org structure shows HS2 units ✓

---

## Bug 2: Superadmin Access Restriction — User Raymond

### Symptom
Superadmin **Raymond** receives "access denied" when attempting to access the HS2 company context.

### Root Cause
`resetCompanyContextIfNeeded()` in `public/js/app.js:1365-1371` was auto-correcting **every** user's company context on every `refreshStatus()` call, including managers.

**Original code:**
```javascript
function resetCompanyContextIfNeeded() {
  const userCompany = getUserCompanyContext();
  if (state.companyContext !== userCompany) {
    state.companyContext = userCompany;
    sessionStorage.setItem("companyContext", userCompany);
  }
}
```

**Call chain:**
1. Raymond logs in, `state.companyContext` defaults to `"hangup"` (sessionStorage)
2. Raymond uses company switcher → `state.companyContext = "hs2"`
3. `refreshStatus()` runs (polling) → calls `applyCompanyBranding()` → calls `resetCompanyContextIfNeeded()`
4. `getUserCompanyContext()` returns `"hangup"` (Raymond's unit is not HS2)
5. `state.companyContext` is forced back to `"hangup"`
6. Raymond is kicked out of HS2 context
7. All subsequent API calls use `company=hangup`, so HS2 data is hidden

### Fix Applied
Modified `resetCompanyContextIfNeeded()` to skip auto-correction for managers who have the HS2 company switcher:

```javascript
function resetCompanyContextIfNeeded() {
  if (canManageHs2Company()) return;
  const userCompany = getUserCompanyContext();
  if (state.companyContext !== userCompany) {
    state.companyContext = userCompany;
    sessionStorage.setItem("companyContext", userCompany);
  }
}
```

Now:
- **Managers** (admin/CEO/HR): `resetCompanyContextIfNeeded()` is a no-op. Their company switcher choice persists across refreshes.
- **Scoped users** (OP/TL/agent): Still auto-corrected to their unit's company. They cannot switch companies.

---

## Files Modified

| File | Change |
|------|--------|
| `lib/company-context.js` | `resolveCompanyContextForUser()` — fall through to `getCompanyForUser()` for non-managers with HS2 units |
| `public/js/app.js` | `resetCompanyContextIfNeeded()` — skip auto-correction for managers (`canManageHs2Company`) |

## Verification

| Test Suite | Result |
|-----------|--------|
| `test-hs2-access.js` | All 14 tests pass |
| `test-access-scope.js` | All 11 tests pass |

## Expected Behavior After Fix

| User | Company Context | Organization Tab | Rules Tab | Sales Log |
|------|----------------|------------------|-----------|-----------|
| MG2 (OP, unit=HS-2) | Auto-set to `hs2` | Shows HS2 units/teams/agents | Shows HS2 rules | Shows HS-2 unit only |
| Raymond (admin) | Persistent via switcher | Shows all units (manager) | Shows both tabs (HS2 + HS3) | Shows all units |
| Regular agent (unit=HS-1) | Auto-set to `hangup` | Shows HS-1 units only | Shows HS3 rules | Shows HS-1/HS-3 units |
