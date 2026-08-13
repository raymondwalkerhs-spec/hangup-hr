# N-Company Scalability Plan

## Current State

The app supports exactly **2 companies**: `hangup` (Main Hang-Up) and `hs2` (HS-2). Every company-scoped feature uses a binary model — `isHs2 ? X : Y` — which means adding a 3rd company would cause data leaks and incorrect behavior across the entire stack.

### What already works
- `org_unit_managers` table has a `company` column — new units can be assigned to any company
- `companies` table exists in Supabase for company metadata
- `UNIT_RULES` in `org-hierarchy.js` maps units → company
- Dynamic unit cache (`refreshDynamicHs2Units`) loaded on startup

### What's broken for N > 2
- `parseCompanyContext()` only recognizes `"hs2"`, everything else defaults to `"hangup"`
- `filterEmployeesByCompany()` is binary: HS2 vs not-HS2
- All route filters: `isHs2 ? uc === "hs2" : uc !== "hs2"` — 3rd company data leaks into hangup
- Role permissions are HS2-specific (`canManageHs2Company`, `canSeeHs2InSales`)
- Frontend company switcher has 2 hardcoded buttons
- Registration auto-assigns HS-2 unit for hs2, no generic default

---

## Phase 1: Generic Company Context Layer

**Goal:** Replace binary HS2 logic with generic company resolution.

### 1.1 — `lib/company-context.js` refactor

Replace `_dynamicHs2Units` (HS2-specific Set) with `_companyUnitMap` (Map: company → Set of units):

```js
// Before (binary)
const _dynamicHs2Units = new Set();
function isHs2Unit(unit) { ... }

// After (generic)
const _companyUnitMap = new Map(); // "hs2" → Set(["HS-2", "HS2-PT"])
function getUnitCompany(unit) {
  // Check dynamic map first, then hardcoded UNIT_RULES, default "hangup"
  for (const [co, units] of _companyUnitMap) {
    if (units.has(unit)) return co;
  }
  const rule = orgHierarchy.UNIT_RULES[unit];
  return rule?.company || "hangup";
}
```

Replace `parseCompanyContext()` to accept any company slug:
```js
function parseCompanyContext(value) {
  const raw = String(value || "").trim().toLowerCase();
  // Validate against known companies from DB cache
  if (_knownCompanies.has(raw)) return raw;
  return "hangup"; // default
}
```

Replace `filterEmployeesByCompany()`:
```js
function filterEmployeesByCompany(employees, context) {
  const co = parseCompanyContext(context);
  return list.filter((e) => getUnitCompany(e.unit) === co || e.company === co);
}
```

### 1.2 — Startup: load all companies

```js
async function refreshAllCompanyCaches() {
  // Read companies table
  const companies = await companiesRepo.readAllCompanies();
  _knownCompanies = new Set(companies.map(c => c.slug));
  // Read all unit managers grouped by company
  const mgrs = await orgHierarchy.readUnitManagers();
  _companyUnitMap.clear();
  for (const m of mgrs) {
    const co = m.company || "hangup";
    if (!_companyUnitMap.has(co)) _companyUnitMap.set(co, new Set());
    _companyUnitMap.get(co).add(m.unit);
  }
}
```

---

## Phase 2: Generic Route Filters

**Goal:** Replace all `isHs2 ? X : Y` with `unitCompany === requestedCompany`.

### Files to update

| File | Pattern | Change |
|------|---------|--------|
| `routes/expenses.js` | `company === "hs2"` → `isHs2Unit()` | Use `getUnitCompany(e.unit) === company` |
| `routes/hrms.js` | `isHs2 ? uc === "hs2" : uc !== "hs2"` | Use `uc === company` |
| `routes/api.js` | Position rates `r.company === "hs2"` | Use `r.company === company` |
| `lib/hrms-repo.js` | `isHs2 ? uc === "hs2" : uc !== "hs2"` | Use `uc === company` |
| `routes/sales.js` | `filterHs2SalesForRole` | Generic `filterSalesByCompany` |

### Example fix (expenses):
```js
// Before
if (company === "hs2") {
  expenses = expenses.filter((e) => companyContext.isHs2Unit(e.unit));
} else if (company === "hangup") {
  expenses = expenses.filter((e) => !companyContext.isHs2Unit(e.unit));
}

// After
if (company) {
  expenses = expenses.filter((e) => companyContext.getUnitCompany(e.unit) === company);
}
```

---

## Phase 3: Generic Role Permissions

**Goal:** Replace `canManageHs2Company` with `canManageCompany(companySlug)`.

### `lib/roles.js` changes

```js
// Before
function canManageHs2Company(userRole) { ... }

// After
function canManageCompany(userRole, company) {
  // Check generic permission first
  if (perm(`manageCompany:${company}`, userRole)) return true;
  // Backward compat: admin/ceo/hr can manage any company
  return ["admin", "ceo", "hr"].includes(normalizeRole(userRole?.role));
}

// Keep backward compat wrapper
function canManageHs2Company(userRole) {
  return canManageCompany(userRole, "hs2");
}
```

### Access control catalog
- Add per-company permission keys in RBAC: `manageCompany:hs2`, `manageCompany:hs3`, etc.
- Settings page: show company-specific toggles

---

## Phase 4: Frontend Company Switcher

**Goal:** Dynamic company list from DB, not hardcoded 2 buttons.

### `public/js/app.js` changes

```js
// Before: 2 hardcoded buttons
<button data-company="hangup">Main Hangup</button>
<button data-company="hs2">HS-2</button>

// After: dynamic from state.meta.companies
const companyBtns = (state.meta.companies || [])
  .map(c => `<button data-company="${c.slug}" class="${ctx === c.slug ? 'active' : ''}">${c.name}</button>`)
  .join("");
```

### API: include companies list in `/employees` or `/meta`
```js
const companies = await companiesRepo.readAllCompanies();
res.json({ ..., companies: companies.map(c => ({ slug: c.slug, name: c.name })) });
```

---

## Phase 5: Registration & Employee Assignment

**Goal:** Generic company → default unit mapping.

### `lib/registration.js`
```js
// Before
const resolvedUnit = company === "hs2" ? "HS-2" : normalizeRegistrationUnit(payload.unit);

// After
const defaultUnit = companyContext.getDefaultUnitForCompany(company);
const resolvedUnit = defaultUnit || normalizeRegistrationUnit(payload.unit);
```

### `org_unit_managers` — add `is_default` flag
```sql
ALTER TABLE org_unit_managers ADD COLUMN is_default BOOLEAN DEFAULT false;
```

---

## Phase 6: Company-Specific Rules & Requests

**Goal:** Each company can have its own rules, pay rates, request types.

### Already partially supported
- `position_rates` has `company` column
- `org_unit_managers` has `company` column
- `sales_break_config` could be scoped by company

### Needs work
- Expense request types per company
- Loan request rules per company
- Bonus types per company (already has `bonusTypesForCompany`)
- Attendance rules per company
- Payroll calculation per company

---

## Migration Path (Safe Rollout)

1. **Phase 1** can be done without any breaking changes — add new functions alongside old ones
2. **Phase 2** is a find-and-replace — change all binary filters to generic, test each feature
3. **Phase 3** keeps `canManageHs2Company` as a backward-compat wrapper
4. **Phase 4** is UI-only — reads from DB
5. **Phase 5-6** are new features, no existing behavior changes

### Estimated effort
- Phase 1-2: ~4-6 hours (core refactor, highest risk)
- Phase 3: ~2-3 hours (permissions)
- Phase 4: ~1-2 hours (UI)
- Phase 5-6: ~4-6 hours (new features)

### Testing checklist per phase
- [ ] Organization page shows correct units per company
- [ ] Employee list scoped to selected company
- [ ] Sales filtered by company
- [ ] Expenses/petty cash/bills filtered by company
- [ ] Attendance scoped to company
- [ ] Settings shows company-specific units
- [ ] Registration assigns correct company + unit
- [ ] Company switcher shows all available companies
- [ ] Role permissions correctly gate each company
