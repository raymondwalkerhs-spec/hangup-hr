---
kind: external_dependency
name: Supabase (PostgreSQL + Storage + Auth)
slug: supabase
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
---

### Supabase
- **Role in this repo:** Cloud source of truth for all HR data; Postgres database, file storage bucket `hr-documents`, and user auth via `app_users` table.
- **Integration points:** Express server uses service role key to bypass RLS; Electron UI never talks to Postgres directly. Migrations live in `supabase/migrations/` and are applied via MCP or `npm run apply:migrations`.
- **Auth model:** Custom `app_users` table with bcrypt passwords; JWT-based sessions managed by the app server. Row Level Security denies all anonymous/authenticated access — only the server secret can query tables.
- **Migration status:** Production is Supabase-only (`DATA_BACKEND=supabase`). Google Sheets backend was removed entirely — app throws at startup if legacy mode is set.
- **Key constraint:** One active session per user; new login revokes previous device. Session timeout 10 minutes client-side, 10 hours server-side.