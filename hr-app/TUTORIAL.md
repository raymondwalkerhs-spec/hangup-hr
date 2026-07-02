# Hangup HR — User Guide

Quick guide for daily use of the **Hangup HR** desktop app.  
**Backend:** Supabase · **Local cache:** SQLite on your PC · **Version:** `1.0.9-beta.2`

For a feature overview suitable for presentations, see [`FEATURES.md`](FEATURES.md).

---

## 1. Sign in

1. Open **Hangup HR Beta** (installer shortcut or portable EXE).
2. Enter **username** and **password** (managed by Raymond in **Users**).
3. Optional: **Remember my username** (password is always re-entered).
4. Click **Sign in**.

**First login** needs internet. You will see **Syncing HR data…** while employees, attendance, and payroll load into the local cache.

| Issue | What to do |
|-------|------------|
| No access assigned | Raymond must set your **role** in **Users** |
| Forgot password | Contact Raymond, or use **Settings → Change password** if you know the current one |
| Version blocked | Install the latest EXE from Admin (`app_versions` policy) |
| Update available popup | Click **Update now** to patch in place (desktop only), or ask Admin for a new EXE |

**Notifications** — bell icon in the sidebar (pending leave, document expiry, alerts).

---

## 2. Navigation

| Sidebar | Purpose |
|---------|---------|
| **Dashboard** | Headcount, payroll total, document expiry widget |
| **Employees** | Profiles, nationality, documents, lifecycle |
| **Attendance** | Monthly grid; **Import FP file** for device exports; per-month FP rules |
| **Payroll** | Monthly payroll, payslips, month lock, MoM compare |
| **Bonuses / Deductions / Loans / Salaries** | Payroll inputs; **Loan approvals** (Mark/Phoebe/Raymond only) |
| **Reports** | Monthly report, turnover, rankings, **saved custom reports** |
| **Costs** | Expenses, petty cash, monthly bills *(finance + HR submit)* |
| **Requests** | Annual, unpaid, medical, and same-day off (replaces Leave) |
| **Equipment** | Company asset registry |
| **Organization** | Reporting structure (read-only) |
| **Settings** | Theme, password, holidays, tax rules, refresh |
| **Users** | App logins *(Raymond only)* |
| **Changes** | Full audit log + CSV export *(Admin / CEO)* |

**Footer:** ↻ Refresh · user chip · Logout

---

## 3. Employees

### Find people

- **Search** by name or ID  
- **Filters:** status, unit, **nationality**, **work permit**, **insurance status**  
- **Hide out / inactive** toggle  

### Add an agent

**+ Add agent** → wizard: unit → team → ID → details (including nationality).

### Employee profile (Edit)

- Names, unit, team, position, payment method, photo  
- **Nationality** — suggestions: Egyptian, Sudanese (or type another)  
- **Non-Egyptian** → Work permit: *Have permit* / *Don't have permit*  
- **Egyptian** → Social insurance: *Insured* / *Not insured*  
  - If insured, optionally add type, total amount, and amount deducted from employee  
- **Documents** — upload ID, contract, medical notes, etc. (Supabase Storage)  
- **Warnings & notes** — with escalation levels (1st / 2nd / final)  
- **Lifecycle** *(HR)* — employment periods, re-hire, depart, onboarding, offboarding, clearance, Action Improvement Plans  

---

## 4. Attendance

1. Pick **month**, filter by **unit** / **team**.  
2. Each cell = one employee × one day. Set status (Attended, Half Day, NSNC, Lateness, Day-OFF, etc.).  
3. **Federal holidays** appear as **pink columns** with a tooltip (configured in Settings).  
4. **Working days** can be overridden for the month; a banner shows when a manual override is active.  
5. **Locked payroll months** block edits — unlock from Payroll page.  
6. Changes save automatically (watch for the Saved indicator).

Edits outside an employee’s **active employment period** are rejected (after depart or before re-hire).

---

## 5a. Costs (finance)

- **HR / RTM** submit receipts → **pending approval** until finance approves.  
- **Finance** (Mark, Phoebe, Raymond): approve/deny, mark paid, petty cash, monthly bills.  
- **Petty cash:** balance shown before pay; insufficient funds blocked; **Edit** on posted deposits in the ledger.  
- **Own pocket:** mark paid → **Settle** with employee Instapay reference.

---

## 5b. Fingerprint attendance import

1. Set each agent’s **FP number** on the employee profile (or run `npm run seed:fp-june` after placing `Asset/june fp example.xls`).  
2. **Attendance** → **FP rules** — adjust check-in/out thresholds per month.  
3. **Import FP file** — upload CSV/XLS from the device → **Preview** → **Apply**.  
4. Default check-in: before 2:50 PM = OK; 2:50–3:00 Lateness A; 3:00–3:30 Lateness B; 3:30–5:00 Quarter day; after 5:00 Half day.  
5. Check-out: grace until 1 PM; 7–10 PM = Half day; 10–11:55 PM = Quarter day (unless HR overrides).

---

## 5c. Loan approvals

- **HR** submits loan requests from employee **Loans** (no longer creates active loans directly).  
- **Mark / Phoebe / Raymond** use **Loan approvals** sidebar (hidden from everyone else).  
- Any one executive can approve → loan becomes active for payroll deductions.

---

## 5. Payroll

1. Select **month**.  
2. Review basic, bonuses, deductions, transport, loans, net pay.  
3. Open **payslip** per employee for detail, bonuses, deductions, and status.  
4. **Month lock** — HR can lock a month to prevent further attendance/bonus/deduction edits.  
5. **MoM compare** — quick month-over-month net pay delta.  
6. **Finance handoff ZIP** *(Admin/CEO)* — payroll CSV + all payslip PDFs + change log.  
7. Exports: Cash / Bank / Instapay CSV and PDF, payslip PDF, bulk payslips.

**Payroll approval gates** — cannot mark payslip *received* / *closed* if offboarding, clearance, or equipment return is incomplete.

**Action Plan Week** — during an active week, payroll applies stricter rules (e.g. tripled deductions, Lateness A = 75 EGP). Notes appear on the payslip.

---

## 6. Requests

- **Request types:** Annual (paid Day-OFF), unpaid day off, medical/sick, same-day off.  
- **Rules:** Annual leave is self-only; same-day requests after 12:00 are allowed but flagged late; TL/OP can request for team agents.  
- **Approvers:** Mark, Raymond, Phoebe.  
- Approved annual leave sets **Day-OFF** with **paid leave** flag (counts for payroll working days).

**HS-2 mode:** Use **Manage HS-2** under the app name in the sidebar to switch company context (HS-2 staff only vs main Hangup roster).

---

## 7. Equipment & organization

- **Equipment** — view asset tags, assignments, and availability.  
- **Organization** — read-only view of team reporting lines (Dialing → OP Manager, HR → HR Manager, etc.).

---

## 8. Settings

| Section | Who | What |
|---------|-----|------|
| **Appearance** | Everyone | Light / Dark / Grey / Wine / Dark grey / Alabaster |
| **Change password** | Everyone | Current + new password |
| **Display** | HR | Hide out / inactive employees |
| **Federal holidays** | HR | Import USA 2024–2028, toggle per holiday, year accordion in Settings |
| **Tax rules** | HR / Finance | Rates (default 0% until configured) |
| **Active sessions** | Raymond | List and revoke logged-in devices |
| **Commission types** | Admin / CEO | Manage commission type rates |
| **Refresh** | Everyone | Full re-sync from Supabase |

---

## 9. Documents

- Upload from employee profile → **Docs**  
- Set **expiry date** or tick **No expiry**  
- Dashboard shows documents expiring within 60 days  
- **Download all (ZIP)** per employee  

Files are stored in **Supabase Storage** (`hr-documents` bucket).

---

## 10. Roles

| Role | Typical access |
|------|----------------|
| **ceo** / **admin** | Everything + **Changes** tab |
| **hr** | Full HR work; no **Changes** tab |
| **finance** | Full payroll + read |
| **op** | Unit attendance + unit bonuses/deductions (read) |
| **tl** | Team attendance (edit) + team bonuses/deductions |
| **quality** / **rtm** | Own attendance + own bonuses/deductions; bonuses transferred to others |
| **agent** | Own attendance + own bonuses/deductions (read) |
| **office_assistant** | Same as agent |

### Bonus requests
- **TL / OP / quality / RTM** can **request** a bonus for a dialing agent (Bonuses page → pending queue).
- **HR / admin / CEO** approve or deny; approved bonuses post to payroll.
- **HR / RTM / quality / admin / office_assistant** cannot receive bonuses via requests — only via **payslip** direct add by HR+.

### Sales
- **Sales** nav: add sales, approve/deny/callback (quality/RTM/HR/admin).
- **Dashboard** shows weekly passed/pending counts.
- Agents see own sales only; TL sees team; OP sees unit; quality/RTM/HR see company.

### Costs
- **Costs** nav (finance: Mark, Phoebe, Raymond, finance role; HR can submit).
- Receipts, petty cash, monthly bills, archive with cash receipt number.

Roles are set in **Users** (Raymond). Blank or unknown role = cannot sign in.

---

## 11. Sync behaviour

| When | What happens |
|------|----------------|
| First login | Full import Supabase → SQLite |
| After your edit | Push to Supabase, then quiet re-sync |
| ↻ Refresh | Manual full sync (overlay) |
| Another user edited | Refresh to see their changes |

---

## 12. Session & security

- Auto **logout after 10 minutes** idle  
- Passwords are **bcrypt-hashed** in Supabase — never stored in plain text on the PC  
- Raymond can revoke sessions or reset passwords in **Users**  
- Install only official EXE builds from Admin  

---

## 13. Common issues

| Symptom | Try |
|---------|-----|
| Blank screen after login | Log out, refresh, or reinstall latest EXE |
| Internet required | Check connection; Supabase must be reachable |
| Cannot edit attendance | Month may be **locked**, or date is outside employment period |
| Payslip cannot be approved | Complete offboarding / clearance / equipment return |
| SmartScreen on install | Unsigned build — *More info → Run anyway* |
| Document upload fails | Check internet; contact Admin if bucket permissions issue |

---

## More

- **Build & deploy:** [`README.md`](README.md)  
- **In-app updates (admin):** [`UPDATES.md`](UPDATES.md)  
- **All features:** [`FEATURES.md`](FEATURES.md)  
- **Database layout:** [`SHEET_SCHEMA.md`](SHEET_SCHEMA.md)  
- **Release notes:** [`CHANGELOG.md`](CHANGELOG.md)
