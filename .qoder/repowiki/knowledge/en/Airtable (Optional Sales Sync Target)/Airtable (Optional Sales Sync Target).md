---
kind: external_dependency
name: Airtable (Optional Sales Sync Target)
slug: airtable
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
scope:
    - '**'
---

### Airtable
- **Role in this repo:** Optional outbound sync target for sales data. When configured via environment variables, every sale mutation pushes to Airtable MLA table.
- **Integration pattern:** Upsert by Portal Sale ID field; deduplicates rows on sync; follows MLA column order from template CSV. Attachment URL TTL configurable.
- **Configuration:** Requires `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME`, and `AIRTABLE_SYNC_ENABLED=true`. Optional fields include `AIRTABLE_PORTAL_SALE_ID_FIELD` for upsert lookup control.
- **Usage note:** Completely optional feature — app works without it. Used for external reporting/auditing workflows.