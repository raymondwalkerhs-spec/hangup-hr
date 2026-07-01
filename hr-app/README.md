# Hangup HR — Desktop App (EXE + Installer)



Google Sheets is the **sole source of truth**. A local SQLite cache speeds reads; every write goes to the sheet immediately.



> **Project history:** [`../LOG.md`](../LOG.md)  

> **Repo overview:** [`../README.md`](../README.md)



---



## Google Sheets



| Sheet | ID |

|-------|-----|

| **HR Access** (login) | `1i4KR3e_jNtPMTSDFnbpS7kYzExqEyA0CgLlaZg5KoF8` |

| **HR Data** (employees, attendance, payroll) | `17z8JrLV0_4fSXzsiZRpCZWFJk5FTit3IUkw0c3NOkvU` |



**Service account** (Editor on both sheets, and on the HR Documents Drive folder if using document upload):



```

hrsystem@decoded-flag-420721.iam.gserviceaccount.com

```



---



## Features



| Feature | Status |

|---------|--------|

| Multi-month attendance + batch save | Done |

| NSNC + **NSNC Half Day** (1.5 day penalty) | Done |

| Payroll (basic, lateness, bonuses, deductions) | Done |

| Extra days + 2-week hold + commission per month | Done |

| Payslip PDF | Done |

| Cash / Bank / Insta CSV export | Done |

| Employee documents (Google Drive) | Done |

| Monthly HR reports | Done |

| Change log | Done |

| One-time Excel migration | Done — archived scripts only |



---



## HR Data tabs



| Tab | Purpose |

|-----|---------|

| `Employee_Database` | Employee master |

| `Attendance_Events` | Daily attendance rows |

| `Bonus_Events` / `Deduction_Events` | Payroll adjustments |

| `Payroll_Adjustments` | Extra days, 2-week hold, commission per employee/month |

| `Commission_Types` | Commission rate lookup |

| `Employee_Documents` | Document metadata (files in Google Drive) |

| `Position_Rates` | Salaries |

| `App_Config` | Working days, lateness rules |

| `Change_Log` | Audit trail |



---



## Commands



| Command | Purpose |

|---------|---------|

| `npm start` | Launch Electron desktop app |

| `npm run server` | Express only (browser at localhost:3847) |

| `npm run dist:installer` | Build Windows installer (`Hangup-HR-Setup-*.exe`) |
| `npm run dist:portable` | Build portable EXE — no install, runs from USB/folder |
| `npm run dist:all` | Build **both** installer and portable |
| `npm run dist:mac` | Build macOS DMG + ZIP — **macOS only** (see below) |
| `.\scripts\build.ps1` | Full build script (install + native rebuild + both EXEs) |
| `./scripts/build-macos.sh` | Full macOS build on a Mac (install + native rebuild + DMG/ZIP) |

### macOS builds (not on Windows)

`electron-builder` **cannot** produce `.dmg` / `.app` from Windows. Running `npm run dist:mac` on Windows will exit with instructions.

**Option A — Mac in the office**

```bash
cd hr-app
./scripts/build-macos.sh
```

**Option B — GitHub Actions** (build from your PC without owning a Mac)

1. Push this repo to GitHub.
2. In the repo → **Settings → Secrets → Actions**, add `SERVICE_ACCOUNT_JSON` (paste the full `credentials/service-account.json` file).
3. Run **Actions → Build macOS → Run workflow**, or push a tag like `v1.0.0`.
4. Download `hangup-hr-macos` from the workflow run artifacts.

The Mac build is **unsigned** (no Apple Developer account). Users may need **right-click → Open** the first time.

| `npm run push:sheet` | **Archived** — push `hr-system/data/*.json` to sheet (after `import_data.py`) |

| `npm run reconcile:june` | Compare June payroll JSON vs last Excel export (if file exists) |



---



## Payroll formula



```

Basic = (workingDays + extraDays - halfDays×0.5 - quarterDays×0.25 - nsnc×2 - nsncHalf×1.5) × dailyRate

Net = basic + bonuses - deductions - lateness - 2-week hold (10 days if enabled)

```



---



## Document upload



Set `GOOGLE_DRIVE_FOLDER_ID` in `.env`, or let the app create a folder named `Hangup HR Documents`. Share that folder with the service account as **Editor**.



---



## Notes



- Internet required for sync and saves

- The local `.xlsx` workbook was migrated once; ongoing edits happen only in the app / Google Sheet

- Reconciliation report: `hr-system/data/reconcile-2026-06.json` (some deltas expected where Excel used inline payroll columns not stored as deduction events)


