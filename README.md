# Hangup HR — Project Overview

This folder contains the **Hangup Smart HR** system migrated from your Google Sheet / Excel payroll workbook into a **desktop app** that uses **Google Sheets as the live database**.

## Start here

| What | Where |
|------|--------|
| **Run / build the app** | [`hr-app/`](hr-app/) |
| **App setup & EXE build** | [`hr-app/README.md`](hr-app/README.md) |
| **Full project history & next steps** | [`LOG.md`](LOG.md) |

## Active project: `hr-app/`

Standalone **Electron** desktop app (Windows EXE + installer, macOS DMG).

- **Live-only** — writes go directly to Google Sheets; reads use a local SQLite cache for speed (safe for multiple HR staff).
- **User login** — username/password from the **HR Access** sheet (not Gmail).
- **Data** — employees, attendance, payroll from the **HR Data** sheet.
- **Weekends** — Saturday & Sunday default to `Day-OFF`; can be overridden per day.

## Google Sheets

| Purpose | Sheet ID | Tab examples |
|---------|----------|----------------|
| **HR Access** (who can use the app) | `1i4KR3e_jNtPMTSDFnbpS7kYzExqEyA0CgLlaZg5KoF8` | `User`, `Password`, `status` |
| **HR Data** (employees, attendance, payroll) | `17z8JrLV0_4fSXzsiZRpCZWFJk5FTit3IUkw0c3NOkvU` | `Employee_Database`, `Attendance_Events`, `Position_Rates`, … |

**Service account** (must be Editor on both sheets):

```
hrsystem@decoded-flag-420721.iam.gserviceaccount.com
```

Key file location: `hr-app/credentials/service-account.json`

## Quick start (IT)

```powershell
cd H:\HR\hr-app
npm install
npm start
```

Build installer:

```powershell
npm run dist:installer
```

Output: `hr-app/dist/Hangup-HR-Setup-1.0.0.exe`

**Portable** (no install — copy `Hangup-HR-Portable-*.exe` to a folder or USB; cache lives in `HangupHR-data` next to the EXE):

```powershell
npm run dist:portable
```

Build both:

```powershell
npm run dist:all
# or
.\scripts\build.ps1
```

**macOS** — cannot be built on Windows. Use a Mac or GitHub Actions:

```bash
# On a Mac only:
cd hr-app
./scripts/build-macos.sh
```

Or push to GitHub and run the **Build macOS** workflow (see `hr-app/README.md`).

## Other folders (reference only)

| Folder / file | Status |
|---------------|--------|
| `hr-system/` | **Abandoned** — early Next.js prototype with local JSON; do not use |
| `hr-system/data/` | Cached JSON from the **completed** one-time Excel migration |
| `scripts/import_data.py` | **Archived** — one-time Excel → JSON (source `.xlsx` removed after migration) |
| `decoded-flag-420721-54927f85f245.json` | **Delete after confirming app works** — duplicate of service account key |

## Test login (from HR Access sheet)

| User | Password | status |
|------|----------|--------|
| Aurora | HR123@HS | Active |
| Eva | EVA@123 | Inactive |
| Raymond | Turtle@123 | Terminated |

See [`LOG.md`](LOG.md) for everything we built, decisions made, and what to do next.
