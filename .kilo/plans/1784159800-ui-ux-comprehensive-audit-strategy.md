# Hangup Portal — Comprehensive UI/UX Audit & Redesign Strategy

> **Scope:** Strategic roadmap to move the portal from a "template / solid-color" look to a layered, high-end modern platform, plus functional UX and bug-fix requirements.
> **Basis:** Verified against current code on 2026-07-15. The 2024 "full overhaul" plan (`.kilo/plans/1784089427889-ui-ux-design-overhaul.md`) and the "premium redesign" plan (`.kilo/plans/1784159442-ui-ux-premium-redesign.md`) are **already implemented** for the design-system and shell layers. This document consolidates both, marks what is live, and specifies the remaining work with code-grounded requirements.
> **Guardrails (unchanged):** Never alter `id` / `data-page` / `data-*` attributes or event bindings — RBAC depends on them. Stay token-driven. Run `node --check` after every JS edit. Honor `prefers-reduced-motion`.

---

## 0. Implementation Status (verified)

| Capability | Status | Evidence |
|------------|--------|----------|
| Emerald brand, 7 themes recolored, indigo dropped | ✅ Done | `app.css:7,56,99,…250` `--primary` |
| Pink theme contrast fix (`#be185d`) | ✅ Done | `app.css:250-251` |
| Glass tokens + ambient body gradient | ✅ Done | `app.css:324,329,354` |
| Lucide icon CDN + `refreshIcons()` | ✅ Done | `app.js:1222-1230`, called at `:1257,7277` |
| Attendance `.status-chip` cells + popover | ✅ Done | `app.js:2355`, `bindAttendanceGridEvents:2099-2175` |
| Collapsible Bulk-actions panel (admin) | ✅ Done | `app.js:4313-4424` |
| Tokenized elevation / shadows / motion | ✅ Done | `app.css` `--shadow-*`, `--ease-*`, `--dur-*` |
| T4 Quality ticket → primary action | ❌ Pending | still kebab-only `sales.js:1316` |
| T5 Notification count badges on nav | ❌ Pending | no `nav-badge` in `hrms-features.js` |
| T8 Org page → literal tree | ❌ Pending | still chip/table `hrms-features.js:433` |
| T9 Team dashboard → data viz | ❌ Pending | plain cards `team-dashboard.js:113` |
| T10 Request modals two-pane redesign | ❌ Pending | only refined `modal-header` exists |
| T11 PIN isolation (company-scoped) | ❌ Pending | renders HS2 unconditionally `hrms-features.js:599` |
| T3 Attendance bulk status selection | ❌ Pending | no checkbox column / batch apply |
| T2 "Breaks duplicate slider" | ⚠️ Re-investigate | `sales-config-breaks.js:995` is now slider-free; bug location stale |
| T1 Costs populate | ⚠️ Needs runtime | code paths consistent; root-cause unconfirmed |
| T12 Loading states (skeletons/progress) | 🟡 Partial | `page-loading` exists; no skeleton regions / top progress bar |

---

## PART 1 — Visual & Aesthetic Overhaul

### 1.1 Color Theory & Accessibility
**Where we are:** The emerald brand and the pink contrast fix are in. The remaining risk is the **neutral pairings** in `grey`, `alabaster`, `dark-grey`, and `girly-pink` — the plan flagged `dark-grey` (`--primary:#a1a1aa` on near-black, `app.css:168`) and `grey`/`alabaster` as the next contrast offenders and they were never verified.

**Strategy**
- **Contrast budget as a CI check.** Define a 3-layer semantic scale per theme and enforce it:
  - `--text` ≥ 4.5:1 (body), `--muted` ≥ 4.5:1 (secondary text — currently `--muted` can fall to ~3:1 in `dark-grey`), `--faint` decorative-only and exempt. `app.css:306` `color-mix(in srgb, var(--text) 5%, var(--card))` for `--surface-2` is safe; the problem is `--muted` literals.
  - Replace ad-hoc `color-mix` greys with the semantic scale; never compute contrast-critical text from `color-mix` with a non-1 ratio that can drift across themes.
- **Accent discipline.** `--primary` is used correctly for active nav, focus rings, primary buttons, links. Add a lint rule: accent never fills large surfaces (>40% area) except the sidebar (intended).
- **Verify the 4 unverified themes** with an automated check (e.g., a small Node script that reads `app.css` theme blocks and computes ratios against `--bg`/`--card` for `--text`,`--muted`,`--primary`). Fix `dark-grey` muted and any `grey`/`alabaster` pairings that fail AA.

### 1.2 Depth & Texture
**Where we are:** Glass tokens exist (`--glass-bg` `app.css:324`, `--app-grad` `:329`, applied to `body` `:354` and `.top-app-bar`/`.sidebar` via `.glass`). The "lit-edge" sheen and subtle texture from the premium plan are **not yet applied**.

**Strategy — layered depth, not flat fills**
- **Lit-edge sheen (high value, low risk):** add to `.card`, `.card-elevated`, `.modal` a 1px top highlight:
  `box-shadow: var(--shadow-2), inset 0 1px 0 color-mix(in srgb,#fff 8%,transparent);` dim the white for dark themes via a `--sheen` token.
- **Glass surfaces:** extend `.glass` to floating `.popover` / `.menu` (already tokenized) and `.modal` header/footer (currently `--surface-2`, `app.css:2459`). Keep `backdrop-filter: blur(≤16px)` **always paired with `1px var(--glass-border)`** so edges read on any bg (this is the usual glassmorphism failure mode — invisible borders on busy gradients).
- **Ambient gradients:** `--app-grad` already paints two primary-tinted radial blooms. Tune per theme so blooms sit behind content but never reduce text contrast (lower opacity in `alabaster`/`grey`, slightly higher in `dark`). Add a third faint bloom near the sidebar for balance.
- **Subtle texture:** optional faint dot/line SVG at very low opacity behind the gradient on `--bg` for premium tactility. Keep ≤3% opacity; disable under `prefers-reduced-motion` only if it animates (static is fine).
- **Soft UI, not skeuomorphism:** keep 12–16px radii, soft shadows, 16–24px whitespace. Avoid bevels/hard insets.

### 1.3 Structural Composition
**Strategy**
- **Spatial rhythm:** bump card padding to ~1.25rem (currently tighter), raise `.page-header` bottom margin, standardize `--space-*` usage so related controls cluster and unrelated ones separate.
- **Component shells, not icon swaps:** wrap related controls in labeled `<fieldset>`-like `.field-group` blocks (already used in quality-ticket form, `sales.js:1765` — generalize). Rounded surface cards + hairline border + soft shadow everywhere.
- **Sidebar:** group labels exist; add section **dividers** and a **sticky user/company footer** with the glass treatment (current footer is plain). Active state already uses accent pill — keep.
- **Motion as structure:** keep staggered `fade-in`/`translateY(4px)` content entrance (existing `pageFadeIn`); increase stagger step for card grids so the page "builds" rather than snapping.

### 1.4 Specific Component Redesigns
**Organization Tree (T8).** Replace `renderOrgPage` chip/table (`hrms-features.js:433`) with a literal indented tree: Company → Unit → Team → OP/TL/Agents, using CSS connector lines (`::before`/`::after` or inline SVG). Collapsible nodes, leaf avatars, role badges. Reuse existing RBAC add/remove handlers — only the renderer changes. Token-driven; preserve every `data-*` binding.

**Team Dashboard (T9).** Upgrade `renderTeamDashboardPage` (`team-dashboard.js:113`) to a data-viz view: KPI hero cards with serif tabular numbers (`.card-stat` style), a weekly attendance **sparkline/area chart in inline SVG** (no chart lib), unit-performance bars (CSS `width %`), and a leaderboard panel. Use `--shadow-*` cards, `--surface-2` rails. All data already available in `state`/API; this is presentation-only.

**Request Pop-ups (T10).** Redesign request modals (Requests / IT / Meetings) to a two-pane layout: summary left, action/form right, with a clear status stepper. Larger touch targets, refined `modal-header` (icon + divider, already in CSS), keep `modal-in/out`. Group the long request forms into `.field-group` sections.

**Navigation & Feedback (T12).** Eliminate the "delayed" feel:
- **Skeleton loaders:** replace the single `page-loading` block with per-region shimmer skeletons (table region, stat grid, side panels) using existing `.skeleton-*` shimmer (`app.css:1399`).
- **Top progress bar:** a thin `--primary` bar at `z-notif` that animates during `fetch` (hook into `api()` wrapper in `app.js:488`).
- **Staggered entrance** already specced — apply consistently across all `render*` entry points.

---

## PART 2 — Functional UX Improvements & Feature Enhancements

### 2.1 Information Architecture & Accessibility
**Sales Quality Ticket → primary (T4).** Currently only in the kebab (`sales.js:1316`). Render a **primary icon button** (`ticket` / `message-square-plus`) directly in the Actions cluster whenever `canOpenQualityTicketForSale(s)` is true, before the kebab (`sales.js:1315-1321`). Keep kebab for callback/export/delete. Preserve `data-quality-ticket` + `runSaleAction` "quality" case. This is the highest-ROI, lowest-risk change — do it first.

**Notification badges (T5).** Add `.nav-badge` (count or dot, hides at 0) to Requests / IT / Meetings / Costs nav items. Back with `refreshNavBadges()` querying pending counts (`/requests?status=pending`, `/it-requests?...`, `/meeting-requests?...`, expenses `pending_approval`). **Wrap every query in `try/catch`** so a missing/inaccessible endpoint never breaks nav. Call it after `renderPage` and on an interval (e.g., 60s) + on `visibilitychange`. Preserve RBAC — only show counts the user can see.

### 2.2 Data Logic & Permissions
**PIN isolation (T11 — backend + frontend).** Today `hrms-features.js:588-599` calls `/registration/daily-pin` and renders **both** Main and HS2 PINs unconditionally. Requirements:
- **Backend:** `/registration/daily-pin` must return **only** the PIN for `state.companyContext` (Main vs HS2). Store both server-side but filter by requester's company; never send the opposing company's PIN in the payload.
- **Frontend:** render only the current company's PIN. If a user has cross-company access, gate the other behind an explicit, confirmed company switch — remove the `hs2Pin.pin` unconditional render at `hrms-features.js:599`.
- Add a per-company cache keyed to `state.companyContext` so switching companies re-fetches.

**HS2 org data sync (T11 — backend + frontend).** Ensure `state.meta.units`/`teams` are correctly scoped per company; HS2 tab must load its own units/teams (note `sales.js:26` unit toggle currently excludes HS2). Frontend: when `companyContext==="hs2"`, fetch HS2-scoped org and render; show an **empty-state with a "Sync org data" affordance** if missing; guard so Main units never appear under HS2. This requires a backend fix to scope org data by company — flag to backend owner.

---

## PART 3 — Bug Fixes & Logic Refinement

### 3.1 Cost Management (T1)
**Symptom:** costs/receipts fail to populate when the Cost tab opens. **Code audit (`expenses.js:33-64`):** paths are consistent — `api()` prepends `/api` (`app.js:488`), and the receipt `<a>` already uses `/api/expenses/:id/receipt` (`expenses.js:131`). So the bug is **not** a path mismatch. Likely causes, in order:
1. **Access gating:** `canManage()||canSubmit()` false → renders "no access" card (`expenses.js:35-37`). Intended, not a bug — but confirm the role actually has access.
2. **Company scope:** `/expenses` returns empty for the current `companyContext`. Fix: pass `?company=${state.companyContext}` and ensure backend filters.
3. **Render-time exception** in `statusBadge`/`isOverdue`/`fmt` on a malformed record → whole page fails. Fix: wrap these helpers defensively and render a per-row fallback.
**Action:** reproduce with a manager account, capture which branch; if (2) apply company param, if (3) harden helpers. Receipt link stays as-is.

### 3.2 Attendance Module
**Duplicate sliders (T2).** The plan's cited location (`sales-config-breaks.js:995` `renderBreaksPage`) is **now slider-free** — it renders current break + today's schedules and a "Show break timer" popup (`sales-config-breaks.js:999-1026`). The "duplicate slider" must be re-located: inspect the **break overlay/timer** (`showBreakOverlay`) and the **break config modal** (`enhanceSettings`, `:1028+`) for a control rendered both inline and in a popover, or two bound sliders for the same value. Fix by de-duplicating to a single source of truth.

**Usability redesign (T3a).** Keep frozen ID/Name/Team + summary columns (`app.css` sticky). Increase per-cell hit-area; status already a colored pill with one-tap popover (✅ done). Add a **density toggle** (comfortable/compact) in the attendance toolbar, reusing the existing `state` pattern.

**Bulk selection (T3b) — NEW requirement.** Add a **checkbox column** (or shift-click range select) on employee rows + a **sticky bulk-action bar**: "N selected → Set status [select] Apply". On Apply, iterate over each selected (emp, visible-day) pair and call `queueAttendanceSave(emp, date, status, ov)` (existing handler `app.js:2136`), flushing in one batch. Honor RBAC (`canEditAttendance`). Must reuse the existing save queue — do **not** invent a new persistence path. This is the big attendance win: mark a whole week for many agents in one action.

---

## Prioritized Roadmap

| Order | Item | Priority | Effort | Risk |
|-------|------|----------|--------|------|
| 1 | **T4** Quality ticket → primary action | Med | S | None |
| 2 | **T5** Nav notification badges (gated) | Med | M | Low |
| 3 | **T12** Skeletons + top progress bar + stagger | Med | M | Low |
| 4 | **T3b** Attendance bulk selection | High | L | Low (reuses queue) |
| 5 | **T2** Re-locate & fix breaks duplicate slider | High | S | Low |
| 6 | **T1** Costs root-cause (runtime) + harden | High | S–M | Med (needs repro) |
| 7 | **T8** Org page → literal tree | Med | M | Low |
| 8 | **T9** Team dashboard data viz | Med | M | Low |
| 9 | **T10** Request modals two-pane | Med | M | Low |
| 10 | **1.1** Verify 4 unverified theme contrasts | High | S | Low |
| 11 | **1.2** Lit-edge sheen + glass on popovers/modals | Med | S | Low |
| 12 | **T11** PIN isolation + HS2 org sync (backend contract) | Low | M | Med (backend) |

**Sequencing rationale:** ship the safe, high-ROI frontend wins first (T4, T5, T12, T3b, T2), then the structural redesigns (T8/T9/T10), then the contrast verification, then the backend-dependent items (T1 repro, T11). Every change stays token-driven and preserves RBAC bindings.
