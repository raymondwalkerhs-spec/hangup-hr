---
kind: external_dependency
name: Dropbox (Legacy File Storage)
slug: dropbox
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### Dropbox
- **Role in this repo:** Legacy file storage for sales recordings and confirmations. Being migrated to Supabase Storage but still referenced in older code paths.
- **Integration pattern:** Uses OAuth tokens stored in `.env` (`DROPBOX_ACCESS_TOKEN`, `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`). File operations use Dropbox API for upload/download/delete.
- **Migration status:** New uploads go to Supabase Storage (`hr-documents` / `sales-attachments`), but legacy Dropbox paths may still exist in old sales records. Dedupe scripts don't reliably remove Dropbox blobs since DB paths aren't bucket keys.
- **Constraint:** Separate cleanup process needed to free Dropbox space after database deduplication.