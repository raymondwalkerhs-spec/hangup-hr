# Sales Log — Reference Guide

> **Version:** 2.4.9 · **Backend:** Supabase · **Related:** [`TUTORIAL.md`](TUTORIAL.md), [`FEATURES.md`](FEATURES.md), [`CHANGELOG.md`](CHANGELOG.md)

This document describes the **Sales log**, **filters**, **form fields**, **permissions**, and **admin configuration** in Hangup Portal v1.4.0+ (extended through v1.4.6).

---

## Overview

The Sales log tracks **MLA** and **RPM** sales programs from submission through quality review and client feedback. The page **opens on RPM** by default (MLA is the second tab). Each program uses **separate Supabase tables** and **separate Supabase Storage roots** (including quality recordings).

| Program | Sales table | Attachments table | Storage root |
|---------|-------------|-------------------|--------------|
| **MLA** | `sales` | `sales_attachments` | `mla-sales-attachments/{saleId}/…` (legacy `sales-attachments/…` still works) |
| **RPM** | `rpm_sales` | `rpm_sales_attachments` | `rpm-sales-attachments/{saleId}/…` |

**Strict isolation (2.3.13):** HS-2 unit sales appear **only** when the active company context is HS-2 (sidebar switcher or native HS-2 user). Main Hangup tab never shows HS-2 sales — even for Quality.

Quality records always land in `{storageRoot}/{saleId}/quality_record/` — never shared between programs.

MLA-Ray form fields live in `sales.form_data` jsonb. RPM has its own field catalog and permissions tables (`rpm_sales_*`). The list view, filters, and form fields are configurable by Admin / RTM per program.

**v2.3.17 — RPM Notes:** Optional **Notes** textarea on RPM submit (all other submit fields remain required). Notes appear on edit, view, and quality modals per `rpm_sales_field_permissions`. Quality recordings upload/play inline in React modals (stream via `/attachments/:id/file`).

**v2.3.28 — Member ID:** RPM `memberId` is 11 characters, pattern **NLAN-LAN-LLNN** (N = digit, L = letter except L/O/B/I/Z/S, A = digit or allowed letter). Display groups as `XXXX-XXX-XXXX`. Invalid IDs show **"Wrong MCN"** (2.4.8); existing junk must be repaired (no grandfather). Quality/HR/RTM/Admin/OP/CEO get a **period picker** (Today / Yesterday / Mon–Fri weeks / months + drag calendar). Agent and TL never see it. RPM single-day still uses `?day=` + Cairo 2 AM working day.

### v2.4.8 — Checks uniqueness + form validation

| Feature | Who | Notes |
|---------|-----|--------|
| **Checks MCN uniqueness** | All check submitters | One live row per company + Member ID + working day (**any agent**). Second submit → **409**; edit the existing check to change status. Soft-deleted historical same-day dups + unique index. |
| **Field rules (Checks / Q Feedback edit / RPM)** | All | MCN → Wrong MCN if invalid; phones digits only; full name (and RPM emergency name) letters + space/hyphen/apostrophe. |
| **RPM empty required glow** | Create sale only | After Submit attempt: red field errors for missing requireds (incl. alt/emergency phone). Not on open or draft resume. |
| **RPM duplicate soft warn** | Create sale | Pre-submit ConfirmDialog if prior MCN/phone exists; **Submit anyway** allowed. Notifies Quality + RTM + Admin. |
| **Sale ↔ Q same day** | Auto | Link only when `working_day` matches; disposed Q (`not_int`, etc.) may become **Sale**. |

| Area | Where in app |
|------|----------------|
| Sales list & filters | **Sales log** (sidebar) |
| Add / edit sale | **+ Add sale**, dock **Sale**, or command palette New sale — sidebar **Sales** does not open the form |
| Checks / Q Feedback | **Checks**, **Q Feedback** (sidebar) — MCN uniqueness + disposition funnel |
| View sale (read-only) | Row **View sale** — Access Control **View sale**; fields from Sales permissions **Edit sale** tab |
| Quality review | Row **Quality ticket** |
| Field view/edit ACL | **Sales permissions** (sidebar) — RTM / Admin only |
| Which columns appear | **Log columns** (sidebar) — RTM / Admin only |
| Clients / devices / prices | **Settings → Sales clients & breaks** |
| App-wide role permissions | **Access Control** (separate from sales field matrix) |

| Team dashboards | **Team dashboards** (sidebar) — daily/weekly RPM roster: Passed / Pending / Dropped / Retransfer / Total per agent; matches sale **working day** |

### v2.3.3 — team dashboard date alignment

Team dashboards load **RPM** sales when **working day**, **submission date**, or **effective date** falls on the selected day. Columns match RPM Sales: **Passed**, **Pending**, **Dropped**, **Retransfer**, **Total**. Pick the same **working day** shown in Sales log if totals look empty.

### v1.6.16 — form hardening

| Feature | Who | Notes |
|---------|-----|--------|
| **Delete sale** | Admin, RTM | Edit modal → Delete; removes DB row, attachments, storage, Airtable |
| **Reassign agent/closer** | Admin, RTM, CEO | Unit/team/agent/closer pickers on Edit and Quality ticket |
| **Required validation** | All submitters | Mirrors MLA Airtable form; client + server; **no attachments on Add sale form** |
| **Recording attachments** | Quality, RTM, admin, HR (upload on edit); finance/CEO view | **Hidden from Agent and TL**; not shown on create/submit |
| **Airtable MLA sync** | All MLA sales (when configured) | Columns match `Asset/MLA AIRTABLE SHOULD BE LIKE THIS.csv` order; upsert by Portal Sale ID; dedupe on sync; reset: `node scripts/reset-airtable-sales.js --confirm-wipe --provision --backfill` |
| **Airtable RPM + Q Feedback** | RPM sales + completed Q Feedback + NQ/Age/Duplicate/Under Age (when `AIRTABLE_RPM_BASE_ID` set) | Separate Hangup RPM base. **Live sync is Supabase → Airtable** (DB trigger + Edge Function; the desktop app is not the writer). Edit = PATCH the same row by Portal Sale/Check ID. Q table is completed dispositions only; **NQ Checks** needs a 10-digit form phone. Deploy: `npm run deploy:airtable:rpm-sync`. Historical backfill: `npm run sync:airtable:rpm` |
| **RPM1 Google Form** | New RPM1 sales only | **Supabase** (not the desktop app): INSERT → Edge Function → **both** TEST + Direct Tracking forms (Team Code HS3). Prior sales are not re-sent when a form is added. |
| **Draft** | All on Add sale | MLA and **RPM**: auto-save to browser while typing; closing by mistake and opening Add sale again offers **Resume your saved … draft?** Successful submit clears the draft. |
| **Double submit** | All | Save disabled while in flight; server 409 on duplicate within 2 min |

---

## Working day & list columns

### Working day rule

Sales submitted **before 2:00 AM Cairo** count on the **previous calendar day** for payroll and dashboards (docs historically said 1 AM; code uses hour &lt; 2). The log shows:

| Column | Meaning |
|--------|---------|
| **Day** | Working day (not always the same as submission calendar date) |
| **Time** | Submission time (12h AM/PM) |

List queries use **submission date** for the month view in the React portal (`dateBasis=submission`). Working-day basis remains available via API for legacy/reporting.

Admin / RTM / CEO can correct MLA or RPM **submission date & time** (Cairo) from the Edit modal. Date and time are stored in separate columns and reconstructed for the UI. A sale moved to another month appears under that month after refetch.

### v2.3.23 — RPM controls, search, history, roster freshness

| Feature | Who | Notes |
|---------|-----|--------|
| **Roster freshness** | All submitters | Auth + submit-scope refresh local employees (~15s) so team moves show in agent pickers without restart |
| **Deleted agents** | Dialing picker | Excluded like Out (unless `sales_agent_picker` override) |
| **RPM sort** | All RPM viewers | Default latest→oldest by submission date/time; option oldest→latest |
| **RPM filters** | Quality, HR, RTM, Admin, OP, CEO | Team (current company **dialing** teams only — no HS-2 on Hangup, no HR/Quality), agent & closer (**values already on the loaded sales**; HR/Quality such as Phoebe are never closer options), **day (calendar, defaults to current Cairo working day)**, client, reviewer feedback, client feedback + status/retransfer. **Not shown to Agent or TL.** RPM list auto-refreshes every 30s. |
| **Search** | MLA + RPM | Customer name or phone (primary / alternative), digit-normalized |
| **Edit history** | Quality, RTM, Admin, CEO | History panel on View / Edit / Quality; portal `sale_edit_history` table |

### Log columns (all fields)

Admins configure which columns appear under **Log columns** (sidebar). Every sales form field can be enabled, plus synthetic columns:

| Synthetic column | Shows |
|------------------|-------|
| Day | Working day |
| Time | Submission time |
| Customer | Full name + phone |
| Agent | Agent ID + name |
| Closer | Closer ID + name |

All catalog fields (client, device, bank details, verifier feedback, etc.) are available in the picker. Visibility for each user is the **intersection** of:

1. Column enabled in **Log columns**
2. User's **field view** permission for that field
3. **Admin-only** flag (sensitive columns — Admin/RTM/HR only)

After upgrading to v1.4.1, open **Log columns → Reset defaults**, then enable the columns you need and **Save**.

---

## Toolbar filters (simple)

On **day**, **week**, and **month** views:

| Filter | Who | Scope |
|--------|-----|--------|
| **Search / Status** | Everyone | Customer name/phone; sale status |
| **Sort** (RPM) | Everyone on RPM | Latest→oldest (default) or oldest→latest |
| **Team / Agent / Closer / Day / Client / feedback** (RPM) | Quality, HR, RTM, Admin, OP, CEO | **Not Agent or TL.** Team = org **dialing** teams in the current company (no HS-2 on Hangup, no HR/Quality). Agent and closer = people **already on the loaded sales**; HR/Quality (e.g. Phoebe) never appear as closers. **Day** is a date picker defaulted to today’s Cairo working day (clear to see the whole month). |

Agents and TLs normally see only today’s RPM working day (no period picker). If Access Control → Sales → **View sales this month** (`viewSalesThisMonth`) is allowed for `agent` and/or `tl`, their RPM sales log date range expands to the current month.

Stat cards show **client status** counts (Passed, Pending bank, Processed, Dropped) when the user can view the Client status column. Click a card to filter by that client status.

Internal **workflow status** (passed/pending/denied for payroll) is kept in the database but **not shown** in the sales UI as of v1.4.3.

Quality / RTM / Admin can toggle **HS-1 / HS-2 / HS-3** unit visibility on the log. The **Agent** filter lists dialing agents only (not quality or leadership IDs); quality users see agents in their unit only.

**Who sees which rows (field roles unchanged for Quality / RTM / HR / Admin / CEO / Finance / OP):**

| Viewer | Sees |
|--------|------|
| **Team TL** | Sales on teams they lead |
| **Closer** | Sales where they are the **Closer** field |
| **Agent** | Sales where they are the **Agent** field |

Being assigned as an org closer for a team does **not** by itself show every sale on that team — only rows with their name on Closer (or Agent), unless they are also that team's TL.

---

## Advanced filter (AND / OR / NOT)

Open **Advanced filter** on the Sales log page.

### Rule builder

1. Add one or more **rules** (field + operator + value).
2. **Combine rules with** (AND / OR / NOT) appears only when you have **two or more** rules.
3. Click **Apply filter** — saved in browser `localStorage` per device.

### Operators

| Operator | Meaning |
|----------|---------|
| IS | Exact match (case-insensitive) |
| IS NOT | Does not match |
| CONTAINS | Substring match |
| IS EMPTY | Field has no value |
| IS NOT EMPTY | Field has a value |

### Value inputs (dropdowns)

| Field type | Value control |
|------------|----------------|
| Agent ID, Closer ID, Verifier, Reviewer | Employee dropdown |
| Client | Client catalog dropdown |
| Team | Team dropdown |
| Status, device, payment method, feedback fields | Fixed option lists |
| Working day | Date picker |
| Other text fields | Free text |

All catalog fields are available as filter fields.

---

## Add sale form

**Submit surface (1.6.12+):** Add sale uses `surface=submit` — all catalog fields are editable on create (not Sales permissions ACL). **Quality section is hidden** on submit (1.6.13). Edit sale and quality ticket still use ACL.

### Role-based assignment

| Submitter | Agent | Closer | Unit |
|-----------|-------|--------|------|
| **Agent** | Self (locked) | Default self; own team leaders only | Prefilled, locked |
| **Agent (org closer)** | Active dialing agents on assigned closer team(s) | Default self; any TL / org closer | Closer team unit(s) |
| **TL** (or agent with `leadTeams`) | Agents on led team(s); agents on closer-assigned teams as **agent** | Own-team agents **or** any TL / org closer; default self | Home unit (unlocks if closer teams span units) |
| **OP** | Any active dialing agent | Any agent / TL / closer; default self when listed | Any dialing unit |
| **HR / RTM / Quality / …** | Company dialing pool | Company pool | All units |

**On behalf (leave / IT):** TL — active agents on led team(s) only. OP — active agents in unit. Closer — IT only (same team scope), not leave. IT staff — active agents in their unit.

Agents default **Closer** to themselves (plain agents: self + their team leaders). Org closers and TLs default **Closer** to themselves and remain in the list even with a dialing ID. **Team** is read-only and follows the selected agent. Out / Deleted / company / program filters still apply.

**v2.4.1 — Other (unassigned):** Agent picker includes **Other (unassigned)** at the top (RPM and MLA). Those rows stay in Total, glow amber on the Sales log, and the glow clears after edit assigns a real agent. Other is not a person in Org or payroll.

### Catalog (required when configured)

When RTM/Admin has configured clients in Settings:

- **Client** — from catalog  
- **Device** — product tied to client  
- **Price** — tier tied to device  

### Unit → Team → Agent cascade

On create (scoped per table above):

1. Pick **unit** (or prefilled/locked per role).  
2. **Team** list filters to teams in that unit.  
3. **Agent** list filters to allowed agents on the selected team.  
4. **Closer** — scoped by role (see table above); defaults to the submitter when they are in the list.

### Payment — Bank account

When **Payment method = Bank account**, these fields appear (card fields hidden):

| Field | Description |
|-------|-------------|
| Routing number | Required |
| Bank name | Required |
| Bank account number | Required |
| Bank address | Optional |

### Payment — Card

When **Payment method = Card**, bank fields are hidden; card number, expiry, and CVV are required.

---

## Edit sale & quality ticket

### Edit sale

- **Agent** and **Closer** are read-only (set at create).  
- Other fields follow the **Sales permissions** ACL.  
- **Verifier feedback** and **Client feedback** use dropdowns (see below).
- **Client / Device / Price preselect (1.4.2):** the edit form preselects the catalog Client, Device, and Price from the sale. Catalog IDs are kept on every save; older sales are matched by client name + device type + price. If a sale still shows empty dropdowns, its client/device combination does not exist in the catalog (**Settings → Sales clients & breaks**) — add the product there, or run `node scripts/backfill-sale-catalog-ids.js`.

### Quality ticket

**MLA:** Quality / RTM / Admin (and assigned OP/TL **verifiers** for `verifierFeedback` only) open **Quality ticket** for fields allowed in **Sales permissions** `quality_view_roles`. Access uses the **current** Users role (e.g. after transferring HR-2 to Quality), not a stale session role from before the change.

**RPM:** **Quality ticket** (editable workflow) is for **Quality, RTM, and Admin** only (`workQualityTicket` in Access Control). **Agents, TL, and OP** do not get the Quality button — they use **View sale** (read-only; fields from Sales permissions **Edit sale** / main view). RPM has **no verifier workflow** — only a **Reviewer** field (quality team, including live Quality role after HR→Quality transfers such as HR-2 Eva). **Internal feedback** (`Pending process` / `Processed`, default pending) is **not** on Add sale. Quality / RTM / Admin see it on View, Edit, and Quality ticket; only **Admin / RTM** can edit unless Sales permissions grant Quality later.

Card/bank payment fields show based on `paymentMethod`. Summary shows client, device, agent, status.

---

## Verifier feedback & client feedback (Reviewer / Client status)

Both are **dropdown** fields with role-based edit access configured under **Sales permissions**. Labels in the UI: **Reviewer status** (verifier feedback) and **Client status** (client feedback).

### Verifier feedback

| Option |
|--------|
| Sale done |
| Postdated |
| Pending bank approval |
| On hold |
| Rejected |
| Callback |

**Who can edit:**

- The **assigned verifier** (employee chosen in Assign Verifier)  
- **Quality** role (when working the ticket)  
- **RTM / Admin** — can always edit (override)

### Client feedback

| Option |
|--------|
| Passed |
| Dropped |
| Chargeback |
| Duplicate |
| Retransfer |
| Pending bank approval |
| Processed |

**Who can edit:** **RTM / Admin** only.

View access for both fields is configurable per role on **Sales permissions**.

---

## Permissions pages

### Sales permissions (sidebar) — tabbed (1.6.10)

**Tabs:** **Edit sale** (`main_view_roles` + `edit_roles`), **Quality ticket** (`quality_view_roles` + `edit_roles`), **Attachments** (`sales_attachment_permissions`), **Actions** (approve/deny/callback). Main and Quality **view** columns are independent — changing one tab does not sync the other.

Works like **Access Control**: **1) pick a role**, **2) toggle View / Edit** for the active tab. Fields are grouped by form section.

- Changes are tracked as **unsaved** until you press **Save changes**.  
- **Quality ticket** defaults: only quality-section fields unless explicitly granted in the Quality tab.  
- **Reset all to defaults** — re-seeds fields, attachments, actions, and log columns.  
- App-level gates (`editSales`, `workQualityTicket`, etc.) remain on **Access Control**; per-user exceptions use live role defaults from Access Control.

### Log columns (sidebar)

Full-page table: enable/disable each list column. Does not replace field ACL — a column only shows if the user can **view** that field.

### Access Control (sidebar)

App-wide RBAC (dashboard, payroll, settings, etc.). **Not** sales field columns — use **Sales permissions** and **Log columns** for sales UI.

---

## Export

Users with export permission can download the current filtered list or a single row as **CSV**, **Excel**, or **PDF** (format dropdown + **Export list** or row **Export**).

---

## Admin setup after upgrade

1. **Sales permissions → Reset all to defaults** — loads new bank and feedback fields.  
2. **Log columns → Reset defaults** — registers all column keys in the database.  
3. Enable desired columns → **Save**.  
4. Per role: adjust View/Edit toggles → **Save changes**.  
5. Configure clients/devices/prices under **Settings** if not already done.  
6. *(1.4.2, one-time)* `node scripts/backfill-sale-catalog-ids.js` — fills catalog IDs on old sales so Edit preselects client/device/price. Already run on production during the 1.4.2 release.

---

## Related scripts & tables

| Item | Location |
|------|----------|
| Field catalog | `lib/sales-field-catalog.js` |
| List columns | `lib/sales-list-columns.js`, table `sales_list_column_config` |
| Field permissions | table `sales_field_permissions` |
| Advanced filter engine | `lib/sales-filter.js` |
| Working day logic | `lib/sales-working-day.js` |
| Repair backend teams | `node scripts/repair-backend-teams.js` |
| Payment field backfill (CSV) | `node scripts/backfill-sales-payment-from-csv.js` (`--dry-run` first) — matches phone + submission date; fills empty card/bank fields only |
| Dedupe duplicate sales | `node scripts/dedupe-sales.js` (`--dry-run` first) — keeps best row per phone + date; merges form_data; reassigns unique attachments to survivor |

### Dedupe vs file storage (important)

`dedupe-sales.js` cleans the **database** only:

- Deletes duplicate `sales` rows and orphan `sales_attachments` rows on dropped sales.
- **Reassigns** attachments that exist only on the duplicate sale to the kept sale (no file copy).
- Does **not** call Dropbox delete — legacy recordings/confirmations on Dropbox are unchanged.
- Does **not** reliably remove Supabase Storage blobs (paths in DB are Dropbox paths, not bucket keys).

To free Dropbox space after dedupe, run a separate orphan-file audit (not included in v1.4.3).

### Sales log UI (v1.4.6)

Versions **1.4.3–1.4.5** could throw `PERIOD_LABELS is not defined` when opening **Sales log**. Fixed in **1.4.6** — use **Update now** or install `Hangup-Portal-Setup-1.4.6.exe`.

If the log opens but shows **no sales**, use **Advanced filter → Clear**, or update to the latest **1.4.6** build (fixes blank-value filter rules that hid all rows).

See [`DB_SCHEMA.md`](DB_SCHEMA.md) for migration history (`20260719_v140_sales_org_dashboards.sql` and later).
