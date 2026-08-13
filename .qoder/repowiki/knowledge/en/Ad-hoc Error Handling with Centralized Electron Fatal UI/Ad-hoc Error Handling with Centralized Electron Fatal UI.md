---
kind: error_handling
name: Ad-hoc Error Handling with Centralized Electron Fatal UI
category: error_handling
scope:
    - '**'
source_files:
    - electron/main.js
    - lib/supabase-repo.js
    - lib/network.js
    - lib/supabase-client.js
---

This repository does not implement a structured, repository-wide error handling system. There is no dedicated `errors/` directory, no custom error class hierarchy, no sentinel error constants, and no middleware layer that normalizes errors across the Express API.

**What exists today:**
- Business logic in `lib/*.js` throws plain `Error` objects (e.g. `throw new Error(...)`) or returns rejected promises; callers handle them with `.catch(console.error)` or bare `try/catch`. There are no domain-specific error types.
- The Electron main process (`electron/main.js`) wraps startup, config loading, and update checks in `try/catch` blocks and surfaces unrecoverable failures through a single `showFatalError(title, message)` dialog — this is the only centralized user-facing error presentation path.
- Routes under `routes/*.js` rely on Express's default error propagation; there is no top-level `app.use((err, req, res, next) => ...)` handler to normalize HTTP responses.
- Supabase client wrappers in `lib/supabase-repo.js`, `lib/supabase-client.js`, and `lib/network.js` pass raw Supabase/HTTP errors up the stack without wrapping them into application error codes.
- Tests in `test/*.js` assert on thrown `Error` messages rather than typed error values.

**Conventions developers follow (informal):**
- Throw `new Error(message)` for failure paths; do not define custom classes.
- Propagate errors via rejection; catch at the route or service boundary and log with `console.error` / `console.warn`.
- Use `showFatalError(...)` only from the Electron main thread for unrecoverable startup/config failures.
- No attempt is made to map errors to user-friendly codes or to return structured JSON error responses from the API.

**Rules developers should follow (recommended):**
1. Define a small set of typed error classes in a central `lib/errors.js` (e.g. `NotFoundError`, `PermissionDeniedError`, `NetworkError`) so routes can translate them into consistent JSON payloads.
2. Add an Express error-handling middleware (`app.use((err, req, res, next) => ...)`) that inspects the error type and returns a stable `{ code, message }` response shape.
3. Wrap all Supabase/HTTP calls in the repo layer (`lib/supabase-repo.js`, `lib/network.js`) and rethrow as domain error types instead of leaking library exceptions.
4. Keep `showFatalError` usage restricted to the Electron main process for truly fatal conditions; business-layer errors should be returned to the renderer via IPC or HTTP.
5. Avoid swallowing errors with `.catch(console.error)` in production paths — always propagate or convert to a user-visible result.