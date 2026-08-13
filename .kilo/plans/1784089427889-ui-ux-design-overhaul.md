# Hangup Portal — UI/UX Design Overhaul Plan (Full)

> Single source of truth for the design overhaul. Covers the **global design system** plus **deep-dive recommendations for the four prioritized modules** (Attendance, Payslip, Employee Card, Sales Log). Implementation is deferred until green light.
>
> All recommendations are grounded in the actual code (`public/css/app.css` ~2180 lines, `public/index.html`, `public/login.html`, `public/js/app.js` ~7188 lines, `public/js/sales.js`, `public/js/theme.js`). No source is changed here.

---

## 0. Current-State Findings (verified)

**Why it reads "template-like"**
1. Brand color is textbook AI/SaaS **indigo** (`--primary:#4f46e5`, sidebar `#1e1b4b`, app.css:7,15) — the most generic default look.
2. Typography is the **OS default** (`"Segoe UI", system-ui`, app.css:321). No display face, no tabular numerals for dense payroll/attendance grids.
3. **No icon system** — emoji/unicode glyphs (`☰`,`↻`,`👁`,`🔔`,`✕`,`→`,`🔒`).
4. Sidebar is a **flat list of ~25 nav buttons** with no grouping/icons (index.html:41-69).
5. **Flat depth** — cards use a 1px border + near-invisible `0 1px 2px` shadow.

**Strengths to preserve**
- Robust CSS-variable token architecture (`color-mix` derived surfaces, spacing/radius scales, app.css:286-316).
- 7 switchable `[data-theme]`s (theme.js); RBAC via `classList.toggle("hidden", …)` on `nav-btn` by `id`/`data-page` (app.js:1461-1531).
- Existing motion primitives (shimmer/ripple/modal in-out/`nav-pulse`) and `prefers-reduced-motion` guard (app.css:2134).
- Sticky/frozen table headers & columns, notifications, save indicators, login orbs.

**Corrections to earlier assumptions**
- `.hero` (app.css:1079) is **dead CSS — never rendered**. The dashboard renders `.page-header` + `.card.grid-4` stat cards (app.js:2280-2331). Do **not** design around heroes; optionally reintroduce one on the dashboard.
- `var(--surface1)` is **undefined** (real token is `--surface-2`); wrongly referenced at `app.js:6809` and `6813` → silently transparent. Must be fixed in the token pass.
- `login.html` is a **separate HTML file** with its own `<head>`/inline script and emoji icons; the CDN/font/icon work must cover it too.
- Attendance per-day cell uses a **tiny native `<select class="status-select">`** (78px) + conditional `.transport-ov-select` (app.js:2115,2132); status saved via `queueAttendanceSave` (bindAttendanceGridEvents, app.js:1914-1956). This is the highest-traffic interactive element in the app.
- Payslip is the **most complex modal** (`openPayslipModal`, app.js:3176-3550): dual tabs, 4 stacked alert banners, two-section payslip grid, Bonuses/Deductions cards, a large Month-profile form with 5 Save buttons, and a Payment-splits card.
- Employee Card = `openEmployeeModal` (app.js:2708-2997) containing `employeeFormFields` (app.js:2610-2664) — a long `field-grid` form — plus several `card card-flat` action blocks (promote/release/purge/export) and a danger zone.
- Sales Log = `renderSalesPage` (sales.js:1338-1539): page header + unit-toggle chips + period toolbar + advanced filter + stat grid + table whose sticky Actions column holds a long row of small buttons (View/Edit/Quality ticket/Approve/Deny/Callback/Export/Delete).

---

## 1. Locked Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | **Direction** | Quiet Luxury / Enterprise Calm — restrained neutral canvas + ONE confident accent; serif display face on H1-level headings & stat numbers. |
| 2 | **Themes** | Keep the 7-theme switching system. The default `light` theme is recolored from indigo → new emerald brand; the other 6 (dark, grey, dark-wine, dark-grey, alabaster, girly-pink) are preserved and restyled with the shared system. *Escape hatch: if indigo must stay selectable, keep it as an 8th "Classic Indigo" option.* |
| 3 | **Fonts & icons** | CDN — Google Fonts (Inter + Source Serif 4) + Lucide icon CDN. Graceful fallbacks required (offline Electron). |
| 4 | **Sales row actions** | **Hybrid** (recommended default): primary actions as icon buttons (View, Edit; Approve/Deny when pending) + a `⋯` kebab menu for secondary (Quality ticket, Callback, Export, Delete). Keeps speed for daily approvers, cuts clutter. |
| 5 | **Scope** | Token-driven restyle of existing architecture — no new framework, no backend changes. Preserve all `id`/`data-page`/`data-*` attributes and event bindings (RBAC must remain intact). |

---

## 2. Design System Foundation (tokens)

### 2.1 Color — Brand (default `light` + `dark`)
Replace indigo. Deep **pine-emerald** accent for a calm, premium, non-generic identity.

| Token | Brand Light (default) | Brand Dark |
|-------|----------------------|------------|
| `--bg` | `#F5F6F8` (cool porcelain) | `#0E1116` |
| `--card` | `#FFFFFF` | `#171B21` |
| `--text` | `#161A1F` | `#E8EBEF` |
| `--muted` | `#6B7280` | `#9AA3AF` |
| `--primary` | `#0E6E5C` | `#2FB89A` |
| `--primary-hover` | `#0A5749` | `#43C9AB` |
| `--primary-light` | `#E3F1ED` | `#11302B` |
| `--primary-ring` | `#5FB7A6` | `#2FB89A` |
| `--border` | `#E6E8EC` | `#2A2F37` |
| `--sidebar` | `#10171C` (deep ink, not indigo) | `#0A0D11` |
| `--sidebar-text` | `#C7D0D6` | `#C7D0D6` |

Other 5 themes: keep their accent (`--primary`, `--hero-*`, `--sidebar`) but neutralize canvas + adopt the shared type/elevation/motion. *Alt accent if emerald rejected: ink + brass `#B5832E`.*

### 2.2 Typography (CDN, `display=swap`)
- **UI/body:** `Inter` (400/500/600/700). Stack: `"Inter","Segoe UI",system-ui,sans-serif`.
- **Display (H1-level only):** `Source Serif 4` (or Newsreader) on `.page-header h1`, `.login-title`, `.sidebar-brand strong`, `.card-stat strong` (serif stat numbers = quiet-luxury signature), modal `h2`.
- Add `font-variant-numeric: tabular-nums` to tables, `.amount-*`, `.break-overlay-timer`, stat numbers.
- Body 14.5–15px, line-height 1.5, headings `letter-spacing:-0.02em`.

### 2.3 Elevation & Z-index (new shared tokens, add to `:root` app.css:286)
```
--shadow-1:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08);
--shadow-2:0 4px 6px -1px rgba(16,24,40,.07),0 2px 4px -2px rgba(16,24,40,.05);
--shadow-3:0 10px 15px -3px rgba(16,24,40,.10),0 4px 6px -4px rgba(16,24,40,.06);
--shadow-4:0 20px 25px -5px rgba(16,24,40,.12),0 8px 10px -6px rgba(16,24,40,.07);
--shadow-5:0 32px 64px -12px rgba(16,24,40,.22);
--shadow-accent:0 6px 18px color-mix(in srgb,var(--primary) 30%,transparent);
--z-base:1;--z-sticky:10;--z-sidebar:200;--z-backdrop:150;--z-modal:5000;--z-notif:9000;--z-overlay:10000;
```

### 2.4 Motion tokens
- Easing: `--ease-standard:cubic-bezier(.2,0,0,1)`, `--ease-decel:cubic-bezier(.22,1,.36,1)` (keep), `--ease-emphasized:cubic-bezier(.3,0,.8,.15)`.
- Durations: `--dur-fast:.15s`, `--dur-med:.28s`, `--dur-slow:.42s`.
- Keep and extend `prefers-reduced-motion` block (app.css:2134).

### 2.5 Icon system (Lucide CDN)
- Add Lucide `<script>` to both `index.html` and `login.html` `<head>`; call `window.lucide?.createIcons()` after every `renderPage()` and modal open (add `refreshIcons()` helper in app.js), and in `login.html`'s inline script after view toggles.
- Replace emoji with `data-lucide`: nav-toggle `☰`→`menu`, refresh `↻`→`refresh-cw`, notif `🔔`→`bell`, password `👁`→`eye`, modal close `✕`→`x`, lock `🔒`→`lock`. Keep the glyphs as graceful fallback if Lucide missing.

### 2.6 Spacing / radius (extend existing, app.css:287-299)
- Keep `--space-1..6`, `--radius-sm..xl`. Add `--radius-pill:999px`. Tighten component internal padding slightly for a more refined, less "blocky" feel (e.g., inputs `.65rem .8rem` → `.6rem .85rem`).

---

## 3. Global Component Library (reusable patterns)

Introduce these classes; apply across all modules and the shell.

- **Buttons** (`.btn` family, app.css:839): hover lift `translateY(-1px)` + `--shadow-accent`; `:active scale(.97)`; refined focus ring; generous padding; keep `.is-loading` spinner (app.css:1436). Add `.btn-icon` square icon buttons with tooltips.
- **Fields/inputs** (`.field`, app.css:605): `:focus` accent glow + `--focus-ring`; optional Lucide leading icon (e.g., search `search`, calendar `calendar`); labels `font-weight:600; color:var(--muted)`.
- **Custom select / dropdown** (NEW `.select`): replace heavy native `<select>` usage with a styled trigger + popover menu for non-grid contexts (Employee form Status/Unit/Team/Position, Payslip payroll status, Sales filters). Keep native `<select>` only where density forbids (attendance grid → see §6.1). Spec:
  ```
  .select { position:relative }
  .select-trigger { /* btn-like, chevron icon, status dot optional */ }
  .select-menu { position:absolute; z-index:var(--z-notif); min-width:12rem;
    background:var(--card); border:1px solid var(--border); border-radius:var(--radius);
    box-shadow:var(--shadow-3); padding:.35rem;
    transform-origin:top; animation:pop-in var(--dur-fast) var(--ease-decel); }
  .select-option { display:flex; gap:.5rem; align-items:center; padding:.5rem .6rem;
    border-radius:var(--radius-sm); cursor:pointer; }
  .select-option:hover, .select-option[aria-selected="true"] { background:var(--surface-2); }
  ```
  Accessibility: `role="listbox"`/`option`, `aria-expanded`, keyboard ↑/↓/Enter/Esc, focus trap within menu, click-outside close.
- **Cards** (`.card`, app.css:952): graduate to `--shadow-1`/`-2`; add `.card-elevated` (`--shadow-3`) for modals/hero; interactive cards get hover lift (`.card-stat-click`, app.css:1838). Optional tinted section header.
- **Status pills** (extend `.badge`, app.css:933): rounded `--radius-pill`, tinted bg via `color-mix`, used for attendance/payment states and payroll status.
- **Tabs / segmented control** (NEW `.segmented`): for Payslip dual tabs & Sales period. Sliding active indicator using `--ease-emphasized`:
  ```
  .segmented { display:inline-flex; background:var(--surface-2); border-radius:var(--radius-pill); padding:.2rem; }
  .segmented button { border:none; background:transparent; padding:.4rem .9rem; border-radius:var(--radius-pill); }
  .segmented button.active { background:var(--card); color:var(--primary); box-shadow:var(--shadow-1); }
  ```
- **Banners / alerts** (`.alert`, app.css:1088): keep tokens; add a leading Lucide icon + dismiss (✕) button; stack with consistent spacing; consolidate Payslip's 4 stacked banners into one `.notice-stack`.
- **Modals** (app.css:1099): keep `modal-in`/`out` (app.css:1946-1975); apply `--shadow-4/5`, refined header with icon + divider, footer divider, backdrop blur transition. Add focus trap if missing.
- **Toasts / save-indicator** (`.save-indicator`, app.css:1450): slide-up + fade; success/info/error variants (already exist).
- **Tooltips** (NEW `.tooltip`): for icon buttons (Sales actions, toolbar icons) — `aria-label` + `title` + CSS hover bubble.
- **Popovers / menus** (NEW `.menu`, `.popover`): for Sales kebab, attendance status cell, bulk-actions disclosure.
- **Skeletons / loading** (`.skeleton-*`, app.css:1399): keep shimmer; add inline content skeletons for table regions.

---

## 4. Global UX Architecture & Layout

- **Sidebar IA** (`index.html:41-69` + `app.css`): wrap nav items in `<div class="nav-group"><div class="nav-group-label">…</div>…</div>` with a Lucide icon per `nav-btn`; **active state = accent pill/indicator** (replace `inset 3px 0` white bar, app.css:814). **Preserve every `id`/`data-page`** so RBAC (app.js:1461-1531) is untouched. Groups:
  - Overview: Dashboard
  - People: Employees, Organization, Equipment
  - Time & Attendance: Attendance, Breaks, Requests, Meeting Requests, IT Requests
  - Compensation: Payroll, Salaries, Bonuses, Deductions, Loans, Loan approvals, My payslip
  - Sales: Sales log, Team dashboards, Costs
  - Insights: Reports
  - Administration: Users, Access Control, Sales permissions, Log columns, Rules, Changes, Settings
- **Top app bar** (`#top-app-bar`, index.html:78): add contextual page title/breadcrumb + global search input (currently only hosts the notif bell).
- **Dashboard curation** (`renderDashboard`, app.js:2280): keep structure; apply serif stat numbers, elevation, a light branded greeting strip (no new data). Optional: reintroduce `.hero` as a slim brand strip.
- **Login refinement** (`login.html`): retune orbs to accent, brand wordmark + serif title, refine empty/loading states.

---

## 5. Motion & Micro-interactions (global)

| Interaction | Spec |
|-------------|------|
| Page/content enter | `fade-in` + subtle `translateY(4px)` (existing `pageFadeIn`, app.css:1863); stagger cards via `animation-delay`. |
| Button | hover `translateY(-1px)`+`--shadow-accent`; `:active scale(.97)`; loading spinner. |
| Card (interactive) | hover `translateY(-2px)`+`--shadow-2`. |
| Dropdown / menu / popover open | `opacity 0→1` + `translateY(-4px) scale(.98)→none`, `var(--ease-decel)` ~180ms, `transform-origin:top`. |
| Tab / segmented indicator | sliding pill with `var(--ease-emphasized)` ~280ms. |
| Attendance status change | color transition 200ms + brief `pop-in`/checkmark draw on the chip. |
| Save / toast | slide-up + fade (`--dur-med`). |
| Modal | existing `modal-in`/`out`; add backdrop blur transition. |
| Skeleton / spinner | keep shimmer + ripple. |
| Reduced motion | keep `prefers-reduced-motion` guard (app.css:2134) — collapse all to instant. |

---

## 6. Module Deep-Dives

### 6.1 Attendance (`renderAttendance` app.js:3997; row 1880; cell 2115/2132)

**Layout & hierarchy**
- Keep the frozen grid (sticky ID/Name/Team, app.css:1484-1519) — it is the core. **Also freeze the summary columns** (Work/Late/Ded) as sticky-right, so they stay visible during horizontal scroll.
- Move admin-only bulk actions (Init month, Bulk attended, Bulk agent, Federal day off, Import FP, FP rules) into a **collapsible "Bulk actions" panel** (`.popover`/details) — most daily users don't need them, reducing the flat toolbar clutter (app.js:4080, `monthToolbar`).
- Period/unit/team filters → refined toolbar with search + Lucide icons; keep `bindMonthNav`/`#unit-filter`/`#team-filter` bindings.

**Visual language**
- Canvas: page uses `--bg`; grid container gets `--shadow-1` + subtle inner border.
- Per-day cells: replace the raw native `<select>` look with a **status chip** (colored pill, tinted by status class `.st-attended/.st-dayoff/.st-late/.st-nsnc/.st-empty`). Transport override shown as a small chip/badge inside the cell.
- Holiday/depart markers: replace `🔒` with Lucide `lock`; keep `.att-holiday-cell-note` but refine typography.

**Component & interaction (the key change)**
- Replace `<select class="status-select">` (app.js:2132) with a **`.status-chip` button** that opens a `.popover` menu of statuses. **Preserve `data-emp`/`data-date` and call `queueAttendanceSave`** (app.js:1923) on selection. The popover also reveals the transport-override toggle (currently `.transport-ov-select`, app.js:2115) when the status supports it — preserving `onTransportOverrideChange` (app.js:1918).
- Keep the existing change-handler logic (`bindAttendanceGridEvents`) — only the trigger element changes from `<select>` to chip+popover.

**Motion**
- Chip opens popover with the global dropdown spec; on status pick, chip color transitions + brief pop-in; row/cell subtle highlight.

### 6.2 Payslip (`openPayslipModal` app.js:3176-3550)

**Layout & hierarchy**
- **Profile header** (`.payslip-header`, app.css:1138): turn into a refined "profile hero" — large avatar (`profile-photo-lg`), name in serif, role/unit/ID/payment meta in `--muted`, a primary `payrollStatusBadge` pill, and the "Change photo" action. Monthly salary shown as a prominent serif figure on the right.
- Convert dual tabs (Training/Agent/Combined) to a **`.segmented` control** (app.js:3204-3208); keep `data-payslip-tab` + re-open logic (app.js:3492).
- Consolidate the 4 stacked banners (dual / training-span / gate / final-pay) into one **`.notice-stack`** with icons + dismiss; keep all links/buttons (`gateBanner` offboarding/clearance/equipment links, app.js:3260-3270).
- Restructure body: **Earnings** section (Attendance rows + bonuses) and **Deductions/Net** section as two clean columns (keep `.payslip-section`, app.css:1145). Net/balance as a highlighted totals row (serif).
- Group the many controls: **Bonuses** and **Deductions** add-forms stay as cards; **Month profile** (the big form, app.js:3368-3409) becomes a collapsible "Month settings" panel; **Payment splits** (app.js:3410) becomes "Payment activity" with the list + add form.
- Reduce visible Save buttons: keep one primary **"Save changes"** plus per-section saves, all restyled; the 5 variants (Save Salary/Status/Allowances/Other/All) become a single segmented or a primary "Save all" + a "more" menu. **Preserve all `id`s and handlers** (`save-salary-btn`, `save-status-btn`, `save-allowances-btn`, `save-other-btn`, `save-adj-btn`, app.js:3402-3406).

**Component & interaction**
- Replace native `<select>`s (bonus/deduction type, payroll status, split kind/status) with the `.select` component where space allows; keep `statusOpts` logic (app.js:3278).
- Override "clear" buttons (`✕`, app.js:3377/3383) → Lucide `x` icon buttons.
- Keep delete buttons on bonus/ded/split rows (app.js:3241/3255/3431) as icon buttons with confirm.

**Motion**
- Segmented indicator slide; notice-stack items stagger in; header avatar subtle scale on load; save → toast.

### 6.3 Employee Card (`openEmployeeModal` app.js:2708 + `employeeFormFields` app.js:2610)

**Layout & hierarchy**
- **Profile hero** at top: large avatar + upload/remove actions (keep `profile-photo-block`, app.css:1217, but elevate + center actions).
- Convert the long `field-grid` form into **tabbed sections** — *Identity* (App ID, names, status, company, unit/team, position, payment method), *Contact & Dates* (phone, email, employment/probation/contract dates, FP number, nationality), *Payroll* (exempt toggle, payment method), *Lifecycle* (promote/release/purge/export). **Keep a single `<form id="emp-form">`** so `new FormData(...)` (app.js:2891) still collects everything; tab panels are just visual `<div>`s inside the form.
- Group the `card card-flat` action blocks (app.js:2731-2758) into a clearly separated **"Danger zone"** with confirm modals intact (`openConfirmDeleteModal`/`openConfirmModal`, app.js:2812/2835).

**Component & interaction**
- Replace native selects (Status, Unit, Team, Position, company) with `.select` component; keep `teamSelectHtml`/`positionSelectHtml`/`paymentMethodFieldsHtml` outputs but restyle.
- "Save ID" inline control (app.js:2636) → refined inline field + button; "Change app ID" flow preserved.
- Keep `save-emp` handler (app.js:2889) and all sub-handlers (promote/release/purge/export) — restyle only.

**Motion**
- Tab switch = slide/fade between panels; photo upload = avatar cross-fade; danger actions = confirm modal (existing) with refined motion.

### 6.4 Sales Log (`renderSalesPage` sales.js:1338-1539)

**Layout & hierarchy**
- Page header: keep title + Add sale (primary) + export. Move the **export format `<select>` + Export list** into a single "Export" split button or `.select`.
- **Filters** (agent/closer/client/feedback, sales.js:1387-1406) → collapse into a **"Filters" popover/panel** with the advanced filter; keep `state` bindings + `#sales-clear-filters` (sales.js:1407). Period toolbar → refined; period `<select>` (sales.js:1364) as `.segmented` (day/week/month).
- **Stat grid** (`.card-stat-click`, sales.js:1428) → serif numbers + elevation + hover lift.
- **Table Actions column** (sales.js:1309-1318): adopt the **Hybrid pattern** — primary icon buttons (View `eye`, Edit `pencil`; Approve `check`/Deny `x` when `pending`) + a `⋯` **kebab menu** (`more-vertical`) holding secondary (Quality ticket, Callback, Export, Delete). Keep all `data-*` attributes and handlers (`data-view-sale`, `data-edit-sale`, `data-quality-ticket`, `data-approve`, `data-deny`, `data-callback`, `data-export-sale`, `data-delete-sale`, sales.js:1460-1506). RBAC visibility (`canViewSale`/`canFullEditSale`/etc.) unchanged.
- Unit-toggle chips (sales.js:1351) → refined pill toggles.

**Component & interaction**
- Kebab opens a `.menu` popover (global spec); icon buttons get `.tooltip`s.
- View/Edit sale modals (`openViewSaleModal` sales.js:1570, `openSaleModal`) and quality-ticket/callback modals inherit the refined modal + field/select components.
- Callback modal (sales.js:1509) and Deny prompt (`openPromptModal`) restyle to the new modal/field spec.

**Motion**
- Kebab menu open = popover spec; row hover highlight; approve/deny = chip state transition + row subtle pulse; stat cards stagger in.

---

## 7. Implementation Tasks (ordered, file-by-file)

1. **Token foundation** — `public/css/app.css` `:root` + 7 `[data-theme]` blocks: recolor `light`+`dark` to emerald brand (drop indigo); neutralize+retune other 5; add elevation/z-index/motion tokens (§2.3-2.4); replace hardcoded `box-shadow` literals with `--shadow-*`. **Fix `var(--surface1)`→`var(--surface2)` at app.js:6809 & 6813.** Update `theme.js` THEMES labels + `app.css` `.theme-swatch-*` colors (light swatch → emerald). Remove or optionally repurpose dead `.hero` CSS.
2. **Fonts + icons (CDN)** — add Google Fonts `<link>` (Inter + Source Serif 4, `display=swap`) + Lucide `<script>` to **both** `public/index.html` and `public/login.html` `<head>` (keep `theme.js` first). Add `--font-display` var; set `body` font + apply to H1-level selectors (§2.2). Add `refreshIcons()` in `app.js` (call after `renderPage` + modal open) and in `login.html` inline script. **Icon sweep**: `☰↻🔔👁✕🔒` → Lucide; keep glyph fallback.
3. **Global components** — implement §3 classes in `app.css`: buttons, fields (focus glow + leading icon), `.select` (trigger+menu+keyboard/focus trap), `.segmented`, `.status-pill`, cards elevation, `.notice-stack`, refined modals/toasts, `.tooltip`, `.menu`/`.popover`, skeletons.
4. **Shell IA** — `index.html` sidebar grouping + top-bar title/search (§4); preserve `id`/`data-page`. Apply elevation/motion globally.
5. **Attendance** (app.js:3997-4171, 1880-1956) — sticky summary columns; collapsible bulk-actions; status chip + popover replacing native `<select>` (preserve `data-emp`/`data-date` + `queueAttendanceSave`).
6. **Payslip** (app.js:3176-3550) — profile hero; `.segmented` dual tabs; `.notice-stack`; Earnings/Deductions columns; collapsible Month settings + Payment activity; consolidate Save buttons (preserve `id`s/handlers); `.select` for type/status; Lucide clear buttons.
7. **Employee Card** (app.js:2708-2997, 2610-2664) — profile hero; tabbed single-form sections (Identity/Contact/Payroll/Lifecycle); Danger zone grouping; `.select` for selects; preserve `save-emp` + sub-handlers.
8. **Sales Log** (sales.js:1338-1539, 1570+) — Filters popover; `.segmented` period; stat-card elevation; **hybrid Actions** (icon cluster + kebab menu, preserve `data-*`/handlers/RBAC); refined view/edit/quality/callback/deny modals; unit-toggle pills.
9. **Login & states** (`login.html`) — retune orbs to accent, serif wordmark/title, empty/loading states.

---

## 8. Validation

- `npm start` (Electron): default `light` shows emerald brand, zero indigo anywhere.
- Toggle all 7 themes — each keeps its accent + new type/elevation/motion; no broken contrast; swatches correct.
- **RBAC**: sign in as agent / hr / admin — nav visibility unchanged after sidebar grouping; module buttons (Sales actions, Employee danger zone, Payslip controls) appear per `can*` flags.
- **Attendance**: status chip + popover saves correctly (verify `queueAttendanceSave` fires); transport override reveals on correct statuses; sticky columns (ID/Name/Team + summary) hold during scroll; lock/holiday markers render.
- **Payslip**: dual tabs switch; all 5 Save buttons still persist data; bonuses/deductions add + delete; splits add/mark received/defer/export; photo change; gate/offboarding links navigate.
- **Employee Card**: tabbed sections; Save collects all fields; promote/release/purge/export flows intact; photo upload.
- **Sales Log**: kebab menu opens with correct RBAC items; View/Edit/Approve/Deny/Callback/Export/Delete all work; filters popover + clear; period switch resets filters (sales.js:1377-1384).
- **Offline**: network off → system-font fallback + unicode icon fallback, no layout break.
- **Reduced motion**: animations collapse.
- Verify `--surface2` fix (rules table zebra / edit textarea bg no longer transparent).

---

## 9. Risks / Caveats

- **CDN offline**: fonts/icons need network. Mitigation: robust system-font stack + unicode fallback (done in Task 2). **Recommended fast-follow: self-host fonts under `public/fonts` + vendor Lucide SVGs under `public/img/icons`** for guaranteed offline reliability in the Electron build.
- **Blast radius**: changes concentrate in one ~2180-line CSS file + two HTML heads + `app.js`/`sales.js` render functions. Stay within the token system (no new architecture); restyle, don't rewrite logic.
- **RBAC coupling**: every restyle must preserve `id`/`data-page`/`data-*` attributes and event bindings — the app toggles visibility and binds handlers by these.
- **Serif scope**: display serif on H1-level/stat numbers ONLY — never body or table cells.
- **Attendance grid density**: do not replace the per-cell control with a heavy component that breaks the 30×N grid; the chip+popover must be lightweight and keyboard-operable.

## 10. Open Questions (non-blocking, resolvable at implementation)

- Final accent: emerald (recommended) vs ink+brass — tunable in tokens, no structural change.
- Collapsible sidebar groups + tabbed Employee sections: include now or defer? (recommended include; low-risk to defer)
- Brand logo `hr-team.png` refresh — out of scope unless a new wordmark/icon is wanted.
- Indigo "Classic Indigo" 8th theme — add only if explicitly requested (Decision 2 escape hatch).
