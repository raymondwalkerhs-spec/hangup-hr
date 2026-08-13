# Hangup Portal — Premium UI/UX Redesign & UX Audit (Plan)

> Single source of truth for the next design phase: transform the interface from a "template / solid-color" look into a layered, high-end modern platform.
> This plan is grounded in the actual code (`public/css/app.css`, `public/js/app.js`, `public/js/sales.js`, `public/js/expenses.js`, `public/js/hrms-features.js`, `public/js/team-dashboard.js`, `public/js/sales-config-breaks.js`). No source changed yet by this document; implementation is tracked in the task list at the bottom.

---

## 0. Investigation Findings (verified against code)

- **Costs tab**: `renderCostsPage` (`expenses.js:33`) fetches `/expenses`, `/expenses/bills`, `/expenses/petty-cash/funds`. `api()` prepends `/api` (`app.js:488`), and the receipt `<a>` already uses `/api/expenses/${id}/receipt` (`expenses.js:131`) — so the path is **consistent**, not the bug. The "fails to populate" symptom is therefore most likely (a) access gating `canManage()||canSubmit()` returning the "no access" card, or (b) company-context scoping returning an empty set, or (c) a render-time exception. **Needs runtime/data verification** (see T1).
- **Attendance rows**: `attendanceEmployeeRowHtml` (`app.js:1945`) renders one `.status-chip` button + a `.transport-ov-select` per day cell (`attendanceStatusCellHtml:2344`, `transportOverrideHtml:2332`). No literal "slider" exists here — the suspected **duplicate-slider bug lives in the Breaks page** (`sales-config-breaks.js:995` `renderBreaksPage`), which must be inspected (T2).
- **PIN isolation**: `hrms-features.js:588` calls `/registration/daily-pin` and currently renders `hs2Pin.pin` in the same block as the main PIN — there is **no company-scoped isolation** between Main Hangup and HS2 (T11, backend fix required).
- **Org page**: `renderOrgPage` (`hrms-features.js:433`) is a chip/table layout, **not** a literal tree (T8).
- **Team dashboard**: `renderTeamDashboardPage` (`team-dashboard.js:113`) exists; redesign target (T9).
- **Notifications**: notification center + `sidebar-notif-wrap` (`hrms-features.js:233-300`) exist; no per-tab numeric badges yet (T5).
- **Sales Quality Ticket**: currently hidden inside the kebab menu (`sales.js` kebab builder ~1507; `runSaleAction` "quality" case). Plan moves it to a **primary** action (T4).
- **Theme contrast**: `girly-pink` (`app.css:245`) used `#ec4899` primary on `#fff1f5` bg → low contrast. **Fixed** primary→`#be185d`, muted→`#9d3a64`, text→`#6b1133` (T6 done in CSS).
- **Depth**: added glass tokens (`--glass-bg/-border/-blur`, `--ambient-*`, `--app-grad`) to `:root`; applied subtle ambient `body` gradient, glass `.top-app-bar` + `.sidebar`, and a `.glass` utility (T7 partially done in CSS).

---

## 1. Visual & Aesthetic Overhaul

### 1.1 Color Theory & Accessibility
- Establish a **contrast budget**: every theme must meet WCAG AA (4.5:1 body / 3:1 large UI). Audit all 7 `[data-theme]` blocks; the pink theme was the worst offender and is fixed. Next: verify `dark-grey` (`--primary:#a1a1aa` on near-black) and `grey`/`alabaster` pairings.
- Define a **3-layer semantic scale** per theme: `--text` (primary), `--muted` (secondary, but ≥4.5:1), `--faint` (decorative only, exempt). Replace ad-hoc `color-mix` greys.
- Use the accent **only** for interactive/active states, never large fills; reserve `--primary` for focus rings, active nav pill, primary buttons, links.

### 1.2 Depth & Texture (replace flat surfaces)
- **Glassmorphism** (already tokenized): apply `.glass` to `.top-app-bar`, `.sidebar`, floating `.popover`/`.menu`, and `.modal` header/footer. Keep blur ≤16px and always pair with a 1px `var(--glass-border)` so edges read on any bg.
- **Ambient gradients**: `--app-grad` (already added) paints two soft primary-tinted radial blooms behind content; tune per theme so they never reduce text contrast.
- **Layered elevation**: cards get `--shadow-1/2`; modals `--shadow-4/5`; add a 1px top sheen (`linear-gradient(180deg, color-mix(#fff 5%, transparent), transparent 38%)`) to `.card`/`.card-elevated`/`.modal` for a "lit edge" depth cue.
- **Subtle texture**: optional faint dot/grid SVG background on `--bg` at very low opacity (behind the gradient) for premium tactility without noise.
- Avoid skeuomorphism; aim for **Soft UI** (soft shadows, rounded 12–16px radii, generous 16–24px whitespace).

### 1.3 Structural Composition
- Increase spatial rhythm: bump `--space-*` usage; raise card padding to ~1.25rem; raise page-header bottom margin.
- Redesign **component shells**: rounded "surface" cards with hairline borders + soft shadow; group related controls into labeled sections (`<fieldset>`-like `.field-group`).
- Sidebar: group labels already exist; add section dividers + a sticky user/company footer with the new glass treatment.
- Move from icon-swap-only polish to **systematic component language** (buttons, fields, chips, tabs, popovers) already partly in place — extend consistently.

### 1.4 Specific Component Redesigns
- **Organization Tree (T8)**: replace chip table with a literal **indented tree** — Company → Unit → Team → OP/TL/Agents, using connector lines (CSS `::before`/`::after` or SVG). Collapsible nodes, avatars on leaves, role badges. Keep all existing RBAC add/remove handlers.
- **Team Dashboard (T9)**: high-end data-viz view — KPI hero cards (serif numbers), a weekly attendance trend **sparkline/area chart** (inline SVG, no heavy lib), unit performance bars, and a "leaderboard" panel. Use tabular-nums + `--shadow` cards.
- **Request Pop-ups (T10)**: redesign request modals as a two-pane layout (summary left, action/form right) with a clear status stepper, larger touch targets, and the refined modal header (icon + divider) already in CSS. Smooth `modal-in/out` kept.
- **Navigation & Feedback (T12)**: eliminate "delayed" feel with **skeleton loaders** (`page-loading` → shimmer blocks per region), a top **progress bar** during `fetch`, and staggered `fade-in`/`translateY` content entrance (motion tokens already exist). Add `prefers-reduced-motion` guard.

---

## 2. Functional UX Improvements & Feature Enhancements

### 2.1 Information Architecture & Accessibility
- **Sales Quality Ticket → main view (T4)**: render a primary icon button (`ticket`/`message-square-plus`) directly in the Actions cluster (not only the kebab) whenever `canOpenQualityTicketForSale(s)` is true. Keep kebab for the rest.
- **Notification badges (T5)**: add a small numeric `.nav-badge` to Requests / IT / Meetings / Costs nav items. Backed by a `refreshNavBadges()` that queries pending counts (`/requests?status=pending`, `/it-requests?...`, `/meeting-requests?...`, expenses `pending_approval`) and renders a count or dot; hides at 0. Guard with `try/catch` so a missing endpoint never breaks nav.

### 2.2 Data Logic & Permissions
- **PIN isolation (T11 — backend + frontend)**:
  - Backend: `/registration/daily-pin` must return **only the PIN for `state.companyContext`** (Main vs HS2). Store both server-side but filter by the requester's company; never send the opposing company's PIN.
  - Frontend: render only the current company's PIN; if a user has cross-company access, gate the other behind an explicit, confirmed company switch. Remove the current `hs2Pin.pin` unconditional render (`hrms-features.js:588-604`).
- **HS2 org data (T11 — backend)**: ensure `state.meta.units`/`teams` are correctly mapped per company; the HS2 tab must load its own units/teams (currently the unit toggle excludes HS2 — `sales.js:26`). Frontend: when `companyContext==="hs2"`, fetch HS2-scoped org and render; show an empty-state with a "Sync org data" affordance if missing. Add a guard so Main units never appear under HS2.

---

## 3. Bug Fixes & Logic Refinement

### 3.1 Cost Management (T1)
- Root-cause by running the Costs page with a manager account; capture whether it's access (shows "no access"), empty data (company scope), or exception. Fix:
  - If access: no code change (intended).
  - If empty due to scope: pass `?company=${state.companyContext}` to `/expenses` and ensure backend filters.
  - If exception: wrap risky helpers (`statusBadge`/`isOverdue`/`fmt`) defensively.
  - Receipt link already correct (`/api/expenses/:id/receipt`); keep consistent.

### 3.2 Attendance Module (T2, T3)
- **Duplicate sliders (T2)**: inspect `renderBreaksPage` (`sales-config-breaks.js:995`) for a double-rendered range/switch control; likely a toggle rendered both inline and in a popover, or two bound sliders for the same value. Fix by de-duplicating the control and ensuring a single source of truth.
- **Redesign for usability (T3a)**: keep frozen ID/Name/Team + summary columns; increase cell hit-area; show status as a colored pill with a one-tap popover; add a **density toggle** (comfortable/compact).
- **Bulk selection (T3b)**: add a checkbox column (or shift-click range select) on employee rows + a sticky **bulk-action bar** ("N selected → Set status [select] Apply"). Reuse `queueAttendanceSave` per (emp,day) and flush in one batch. Honors RBAC (`canEditAttendance`).

---

## 4. Prioritized Task List (status)

| # | Task | Priority | Status |
|---|------|----------|--------|
| T1 | Fix Costs tab populate (root-cause + fix) | High | Pending (needs runtime check) |
| T2 | Fix Attendance duplicate-sliders (Breaks page) | High | Pending |
| T3 | Attendance: redesign + bulk status selection | High | Pending |
| T4 | Sales Quality Ticket → primary action | Med | Pending |
| T5 | Notification count badges on nav tabs | Med | Pending |
| T6 | Theme contrast & accessibility pass | High | **Done (pink fixed; other themes to verify)** |
| T7 | Depth/glassmorphism tokens + shell elevation | High | **Partial (tokens + top bar/sidebar glass done)** |
| T8 | Org page → literal tree hierarchy | Med | Pending |
| T9 | Team Dashboard → high-end data viz | Med | Pending |
| T10 | Request modals redesign | Med | Pending |
| T11 | PIN isolation + HS2 org-data (backend contract + frontend guards) | Low | Pending (backend required) |
| T12 | Loading states: skeletons + progress + smoother transitions | Med | Pending |

## 5. Implementation Order & Guardrails
1. Finish T7 (cards/modal sheen, chart-free viz primitives) → T6 verification of remaining themes.
2. T4 (safe, high-value) → T5 (safe, gated) → T3 (attendance bulk) → T2 (breaks dup).
3. T8/T9/T10 structural redesigns (contained, keep all `id`/`data-*`/handlers).
4. T1 root-cause via runtime; T11 backend contract + frontend guards.
5. T12 loading states last (global, low-risk).

**Guardrails**: never change `id`/`data-page`/`data-*` attributes or event bindings (RBAC depends on them); keep token-driven changes; run `node --check` after each JS edit; keep `prefers-reduced-motion` honored.
