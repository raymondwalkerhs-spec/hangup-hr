# Sales Log — Reference Guide

> **Version:** 1.4.6 · **Backend:** Supabase · **Related:** [`TUTORIAL.md`](TUTORIAL.md), [`FEATURES.md`](FEATURES.md), [`CHANGELOG.md`](CHANGELOG.md)

This document describes the **Sales log**, **filters**, **form fields**, **permissions**, and **admin configuration** in Hangup Portal v1.4.0+ (extended through v1.4.6).

---

## Overview

The Sales log tracks MLA-Ray sales from submission through quality review and client feedback. Data is stored in Supabase (`sales` table + `form_data` jsonb). The list view, filters, and form fields are configurable by Admin / RTM.

| Area | Where in app |
|------|----------------|
| Sales list & filters | **Sales log** (sidebar) |
| Add / edit sale | **+ Add sale** or row **Edit** |
| Quality review | Row **Quality ticket** |
| Field view/edit ACL | **Sales permissions** (sidebar) — RTM / Admin only |
| Which columns appear | **Log columns** (sidebar) — RTM / Admin only |
| Clients / devices / prices | **Settings → Sales clients & breaks** |
| App-wide role permissions | **Access Control** (separate from sales field matrix) |

---

## Working day & list columns

### Working day rule

Sales submitted **before 1:00 AM Cairo** count on the **previous calendar day** for payroll and dashboards. The log shows:

| Column | Meaning |
|--------|---------|
| **Day** | Working day (not always the same as submission calendar date) |
| **Time** | Submission time (12h AM/PM) |

List queries use **working day** by default (`dateBasis=workingDay`).

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

| Filter | Scope |
|--------|--------|
| **Client** | Sales for selected catalog client |
| **Agent** | Sales where this agent submitted |
| **Closer** | Sales where this employee closed |
| **Client status** | Client feedback dropdown (Passed, Dropped, …) |
| **Reviewer status** | Verifier feedback dropdown (Sale done, Callback, …) |
| **Period** | Daily / Weekly / Monthly |

Stat cards show **client status** counts (Passed, Pending bank, Processed, Dropped) when the user can view the Client status column. Click a card to filter by that client status.

Internal **workflow status** (passed/pending/denied for payroll) is kept in the database but **not shown** in the sales UI as of v1.4.3.

Quality / RTM / Admin can toggle **HS-1 / HS-2 / HS-3** unit visibility on the log. The **Agent** filter lists dialing agents only (not quality or leadership IDs); quality users see agents in their unit only.

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

### Catalog (required when configured)

When RTM/Admin has configured clients in Settings:

- **Client** — from catalog  
- **Device** — product tied to client  
- **Price** — tier tied to device  

### Unit → Team → Agent cascade

On create:

1. Pick **unit** (HS-1 / HS-2 / HS-3 dialing units).  
2. **Team** list filters to teams in that unit.  
3. **Agent** list filters to agents on the selected team.  
4. **Closer** — any dialing employee (company-wide).

Dialing agents default **Agent** to themselves; TL/OP default **Closer** to themselves.

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

Quality / RTM (and assigned OP/TL verifiers) open **Quality ticket** for fields allowed in **Sales permissions** `quality_view_roles`. Card/bank payment fields show based on `paymentMethod`. Summary shows client, device, agent, status.

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
