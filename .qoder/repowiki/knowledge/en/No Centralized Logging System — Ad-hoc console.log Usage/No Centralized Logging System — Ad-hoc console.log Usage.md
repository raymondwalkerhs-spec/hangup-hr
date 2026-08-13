---
kind: logging_system
name: No Centralized Logging System — Ad-hoc console.log Usage
category: logging_system
scope:
    - '**'
source_files:
    - app.js
    - electron/main.js
    - lib/changelog.js
    - lib/airtable-sales-sync.js
    - lib/data-store.js
    - public/js/app.js
---

This repository does not implement a centralized logging system. There is no dedicated logger framework (e.g., log4js, winston, pino), no shared logger module, and no configuration for log levels, sinks, or structured output.

Instead, the codebase uses ad-hoc `console.log`, `console.warn`, and `console.error` calls scattered across modules:
- **Electron main process** (`electron/main.js`) — no logging; errors are surfaced via `dialog.showErrorBox`.
- **Express server** (`app.js`) — startup warnings use `console.warn("[startup] ...")`; the Express error handler prints the raw error object with `console.error(err)`.
- **Business logic** (`lib/airtable-sales-sync.js`, `lib/changelog.js`, `lib/data-store.js`) — uses `console.error` / `console.warn` with bracketed prefixes like `[airtable]` to tag messages.
- **Frontend SPA** (`public/js/app.js`) — debug logs prefixed `[attendance-debug]` are emitted directly from browser code.
- **Ad-hoc scripts** at the repo root — heavy use of `console.log` / `console.error` for one-off data-migration and inspection tools.

The only structured "logging" facility is the application audit trail in `lib/changelog.js`, which persists change events to the Supabase `change_log` table via `logChange()` helpers (`logEmployeeChange`, `logAttendanceChange`, etc.). This is an audit-log sink, not a general-purpose logger.

There are no conventions around log levels, no environment-driven verbosity control, and no file/network sinks — all output goes to the Node stdout/stderr stream.