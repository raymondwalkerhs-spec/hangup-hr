# Hangup HR — Project Log

Chronological record of what was done, current state, and recommended next steps.

---

## 2026-07-01 — Session 1: Understand the spreadsheet system

### What we did
- Analyzed `HR System June 2026 V.2 (1).xlsx` (export of your Google Sheet payroll system).
- Mapped **36 tabs**, ~20,000 formulas, and core business logic.

### Key findings (original sheet)
- **Employee_Database** — master employee list (~127 active IDs).
- **Attendance** — wide matrix (one row per employee, columns per working day).
- **Payroll_June2026** — ~9,500 formulas pulling attendance, bonuses, deductions.
- **Unit views** — duplicate tabs filtered by HS-1, HS-2, HS-3, PT, Back-End.
- **Lateness** — manual status cells; A = 25 EGP (before 3 PM), B = 50 EGP (after 3 PM).
- **Payroll formula** — `Daily Rate = Monthly Salary ÷ working days`; basic salary adjusts for half days, quarter days, NSNC.
- **Problems identified** — no real access control, formula fragility, monthly copy/paste ritual, wide attendance layout doesn’t scale, no multi-user safety.

### Decisions discussed
- Move calculations to an app; keep Google Sheets as database.
- Normalize attendance to rows (not wide columns).
- Role-based access per unit.

---

## 2026-07-01 — Session 2: First app prototype (`hr-system/`)

### What we did
- Built **Next.js** app in `hr-system/` with:
  - Imported JSON from Excel (`employees`, June attendance, July weekend defaults).
  - Multi-month attendance UI.
  - Sat/Sun default `Day-OFF` with override.
  - Payroll preview from position rates.
- Created `scripts/import_data.py` to extract data from the `.xlsx`.

### Blocked
- `npm install` on `H:\HR` repeatedly failed (`EPERM`, `ENOTEMPTY` — file locks / antivirus on `node_modules`).

### Status
- **`hr-system/` is abandoned.** Use `hr-app/` instead.

---

## 2026-07-01 — Session 3: Requirements change

### User requirements
1. **No offline cache** — multiple HR users editing; data must always be live on the sheet.
2. **Desktop EXE + installer** — install on each PC, not a browser-only tool.
3. **Login from HR Access sheet** — not Gmail OAuth.
4. **Session behavior:**
   - `Active` → login once per session; no password prompt until logout.
   - Every **5 minutes** → re-check sheet; if status/password changed → “Contact Admin”.
   - `Terminated` → app silently uninstalls.
   - `Inactive` → login blocked.

### Sheet IDs confirmed
| Sheet | ID |
|-------|-----|
| HR Access | `1i4KR3e_jNtPMTSDFnbpS7kYzExqEyA0CgLlaZg5KoF8` |
| HR Data | `17z8JrLV0_4fSXzsiZRpCZWFJk5FTit3IUkw0c3NOkvU` |

---

## 2026-07-01 — Session 4: Desktop app (`hr-app/`)

### What we built

```
hr-app/
├── electron/main.js      # Desktop window, 5-min access poll, silent uninstall
├── electron/preload.js
├── app.js              # Express server (serves UI + API)
├── server.js             # Dev: node only (no Electron)
├── lib/
│   ├── google-auth.js    # Service account → Sheets API
│   ├── auth-sheet.js     # Read User/Password/status from HR Access sheet
│   ├── sheets.js         # Read/write HR Data sheet (live)
│   ├── session-store.js  # In-memory session (password not saved to disk)
│   ├── network.js        # Internet required check
│   ├── uninstall.js      # Silent NSIS uninstall for Terminated users
│   ├── attendance.js     # Summaries, weekend skeleton, lateness math
│   ├── payroll.js        # Basic salary calculations
│   ├── calendar.js       # Multi-month, Sat/Sun detection
│   └── roles.js          # Permission helpers
├── routes/api.js         # REST API (login, attendance, employees, payroll)
├── public/               # Web UI inside Electron
├── credentials/
│   └── service-account.json
└── .env
```

### Removed (on purpose)
- Offline cache / write queue / “Sync now”.
- Google OAuth (Gmail login).
- `hr-system` Next.js approach.

### Auth model (two layers)

| Layer | How |
|-------|-----|
| **Who can open the app** | Username + password vs HR Access sheet (`Active` / `Inactive` / `Terminated`) |
| **How app talks to Sheets** | Google **service account** JSON key |

Service account email:
```
hrsystem@decoded-flag-420721.iam.gserviceaccount.com
```

### Service account key configured
- Source: `H:\HR\decoded-flag-420721-54927f85f245.json`
- Installed to: `hr-app/credentials/service-account.json`
- `.env` created with sheet IDs and key path.

### HR Data sheet tabs used by app

| Tab | Purpose |
|-----|---------|
| `Employee_Database` | Existing employee master (read) |
| `Attendance_Events` | **New normalized tab** — one row per employee per day |
| `Position_Rates` | Salary lookup |
| `App_Config` | Working days per month, lateness rules |
| `App_Users` | Optional fine-grained roles (not required yet) |

### Attendance behavior
- Any month via month picker.
- **Saturday & Sunday** → auto `Day-OFF` when using **Init weekends**.
- Weekday cells empty until marked.
- Each edit writes **immediately** to `Attendance_Events`.

---

## Current status (as of last session)

| Item | Status |
|------|--------|
| App code in `hr-app/` | Done |
| Service account key in `credentials/` | Done |
| `.env` configured | Done |
| Share both sheets with service account | **You must verify** |
| `npm install` on H: drive | **Often fails** — may need `C:\hangup-hr` or close locks |
| EXE installer built | **Not yet** — run `npm run dist:installer` after install works |
| Delete duplicate key from `H:\HR\` root | **Recommended** after testing |
| Full payroll (bonuses, deductions, payslips) | **Not yet** — only basic + lateness |
| Migrate June wide attendance → `Attendance_Events` | **Not yet** |

---

## What to do next (checklist)

### Immediate (IT — you)

- [ ] **1. Share both Google Sheets** with `hrsystem@decoded-flag-420721.iam.gserviceaccount.com` as **Editor**
- [ ] **2. Install dependencies**
  ```powershell
  cd H:\HR\hr-app
  npm install
  ```
  If it fails on `H:\`, copy `hr-app` to `C:\hangup-hr` and install there.
- [ ] **3. Test connection**
  ```powershell
  cd H:\HR\hr-app
  node -e "require('dotenv').config(); const {fetchAuthUsers}=require('./lib/auth-sheet'); const s=require('./lib/sheets'); (async()=>{console.log(await fetchAuthUsers()); console.log((await s.readEmployees()).length+' employees')})();"
  ```
- [ ] **4. Run the app**
  ```powershell
  npm start
  ```
- [ ] **5. Login test** — Aurora / `HR123@HS` (must be `Active` in Access sheet)
- [ ] **6. Attendance** — open July 2026 → **Init weekends** → mark a weekday → confirm row appears in `Attendance_Events` on the sheet
- [ ] **7. Build installer**
  ```powershell
  npm run dist:installer
  ```
- [ ] **8. Delete** `H:\HR\decoded-flag-420721-54927f85f245.json` after confirming app works (keep only `credentials/service-account.json`)

### Short term (HR features)

- [ ] Import historical June attendance from Excel into `Attendance_Events` (script or manual)
- [ ] Add **Bonus** and **Deduction** tabs (live read/write like original sheet)
- [ ] Full **payroll run** matching original formulas (2-week hold, commissions, payment splits Cash/Bank/Insta)
- [ ] **Payslip PDF** per employee
- [ ] **Unit-based roles** in `App_Users` tab (TL sees only HS-1, etc.)

### Medium term

- [ ] Auto lateness from clock-in times (if fingerprint export available)
- [ ] Approval workflow for attendance changes
- [ ] Audit log tab (`who changed what, when`)

---

## Known issues

1. **`npm install` on `H:\HR`** — Windows file locks (`EPERM`, `ENOTEMPTY`). Workaround: install on `C:\` or run terminal as admin / exclude folder from antivirus.
2. **Excel had June only** — July was initialized with weekend defaults; weekdays need manual entry or import.
3. **Service account key in repo root** — security risk; delete duplicate after setup.
4. **Terminated uninstall** — only works if app was installed via NSIS installer (not raw `electron .` dev mode).

---

## File map (entire `H:\HR`)

```
H:\HR\
├── README.md                 ← This overview
├── LOG.md                    ← This log
├── hr-app/                   ← ★ USE THIS — desktop app
├── hr-system/                ← Abandoned Next.js prototype
├── scripts/import_data.py    ← Excel → JSON (for old prototype)
├── hr-system/data/           ← Imported JSON (employees, attendance)
├── HR System June 2026....xlsx
└── decoded-flag-....json     ← Delete after setup (duplicate key)
```

---

## Contact / admin workflow

To **disable** a user → set `status` to `Inactive` in HR Access sheet.  
To **revoke and remove app** → set `status` to `Terminated` (app uninstalls on next 5-min check or login).  
To **change password** → edit Password column; user sees “Contact Admin” within 5 minutes.

---

*Last updated: 2026-07-01*

---

## 2026-07-01 — Session 5: Full HR roadmap (calculations, migration, features)

### What we did
- **NSNC Half Day** — new attendance status; payroll penalty `×1.5` day-units (half day + 1 extra).
- **Payroll adjustments** — `Payroll_Adjustments` sheet tab: extra days, 2-week hold, commission type/amount.
- **Commission types** — imported 13 types from Excel into `Commission_Types` tab.
- **One-time migration** — expanded `import_data.py`; pushed to Google Sheet (127 employees, 567 June attendance rows, 47 adjustments, 8 bonuses, 1 deduction).
- **Reconciliation** — `npm run reconcile:june` → 26/36 compared employees within 1 EGP; 10 mismatches (mostly Excel inline payroll columns / ON HOLD bonuses not modeled as deduction events).
- **Payslip PDF** — `GET /api/payslip/:id/pdf` (pdfkit).
- **Bank export** — Cash (CEILING to 5 EGP), Bank, Insta CSV downloads.
- **Employee documents** — upload to Google Drive; metadata in `Employee_Documents`.
- **HR reports** — monthly headcount, attendance, payroll-by-unit (`Reports` page).
- **Retired local Excel** — `HR System June 2026 V.2 (1).xlsx` deleted after sheet migration; import scripts archived.

### Current status

| Item | Status |
|------|--------|
| Google Sheet migration | Done |
| NSNC Half Day | Done |
| Extra days / 2-week hold / commission | Done |
| Payslip PDF | Done |
| Bank/Cash/Insta export | Done |
| Employee documents | Done (needs Drive folder shared with service account) |
| HR reports | Done |
| EXE installer | Rebuild with `npm run dist:installer` after `npm install` |

### Optional follow-ups
- Import remaining Excel payroll-column deductions into `Deduction_Events` if net must match legacy sheet exactly.
- Unit-based roles in `App_Users`.
- Auto lateness from fingerprint export.

*Last updated: 2026-07-01 (Session 5)*
