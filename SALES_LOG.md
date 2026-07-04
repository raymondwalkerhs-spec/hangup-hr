# Sales Log — Reference Guide

> **Version:** 1.4.1 · **Backend:** Supabase · **Related:** [`TUTORIAL.md`](TUTORIAL.md), [`FEATURES.md`](FEATURES.md), [`CHANGELOG.md`](CHANGELOG.md)

This document describes the **Sales log**, **filters**, **form fields**, **permissions**, and **admin configuration** in Hangup Portal v1.4.0+ (extended in v1.4.1).

---

## Overview

The Sales log tracks MLA-Ray sales from submission through quality review and client feedback. Data is stored in Supabase (`sales` table + `form_data` jsonb). The list view, filters, and form fields are configurable by Admin / RTM / HR.

| Area | Where in app |
|------|----------------|
| Sales list & filters | **Sales log** (sidebar) |
| Add / edit sale | **+ Add sale** or row **Edit** |
| Quality review | Row **Quality ticket** |
| Field view/edit ACL | **Sales permissions** (sidebar) |
| Which columns appear | **Log columns** (sidebar) |
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
| **Status** | passed / pending / postdated / denied / callback |
| **Period** | Daily / Weekly / Monthly |

Stat cards (Passed, Pending, Callback, Denied) click to set the status filter.

Quality / RTM / HR / Admin can toggle **HS-1 / HS-2 / HS-3** unit visibility on the log.

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
| Who chose bank account | Employee dropdown |

### Payment — Card

When **Payment method = Card**, bank fields are hidden; card number, expiry, and CVV are required.

---

## Edit sale & quality ticket

### Edit sale

- **Agent** and **Closer** are read-only (set at create).  
- Other fields follow **Sales permissions** matrix.  
- **Verifier feedback** and **Client feedback** use dropdowns (see below).

### Quality ticket

Quality / RTM open **Quality ticket** for review workflow fields (reviewer, quality comments, assign verifier, attachments, verifier feedback). Summary shows client, device, agent, status.

---

## Verifier feedback & client feedback

Both are **dropdown** fields with role-based edit access configured under **Sales permissions**.

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

### Sales permissions (sidebar)

Full-page matrix: **View** and **Edit** per field × role group (Agent, TL, OP, Quality, RTM, PR, Admin, HR, Finance).

- Controls what appears in **Add sale**, **Edit sale**, and **Quality ticket**.  
- **Reset defaults** — re-seeds from catalog (also refreshes log column seeds).  
- Replaces the old modal opened from Access Control.

### Log columns (sidebar)

Full-page table: enable/disable each list column. Does not replace field ACL — a column only shows if the user can **view** that field.

### Access Control (sidebar)

App-wide RBAC (dashboard, payroll, settings, etc.). **Not** sales field columns — use **Sales permissions** and **Log columns** for sales UI.

---

## Export

Users with export permission can download the current filtered list or a single row as **CSV**, **Excel**, or **PDF** (format dropdown + **Export list** or row **Export**).

---

## Admin setup after upgrade

1. **Sales permissions → Reset defaults** — loads new bank and feedback fields.  
2. **Log columns → Reset defaults** — registers all column keys in the database.  
3. Enable desired columns → **Save**.  
4. Adjust field view/edit checkboxes → **Save permissions**.  
5. Configure clients/devices/prices under **Settings** if not already done.

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

See [`DB_SCHEMA.md`](DB_SCHEMA.md) for migration history (`20260719_v140_sales_org_dashboards.sql` and later).
