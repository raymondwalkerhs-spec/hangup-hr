/**
 * Outbound sync: Supabase sales → Airtable "Sales All Data".
 * Fail-open: errors are logged and stored on the sale row; DB writes are never blocked.
 */
const airtable = require("./airtable-client");
const fieldMap = require("./airtable-sales-field-map");
const business = require("./business-repo");
const saleStorage = require("./sale-attachment-storage");
const { getSupabaseAdmin } = require("./supabase-client");

const DEBOUNCE_MS = Number(process.env.AIRTABLE_SYNC_DEBOUNCE_MS || 0);
const pendingTimers = new Map();
const inflight = new Set();

function scheduleSaleSync(saleId, { immediate = false } = {}) {
  if (!saleId || !airtable.isConfigured()) return;
  const key = String(saleId);
  if (pendingTimers.has(key)) clearTimeout(pendingTimers.get(key));
  const delay = immediate ? 0 : DEBOUNCE_MS;
  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      syncSaleById(key).catch((err) => {
        console.error(`[airtable] sync failed for sale ${key}:`, err.message);
      });
    }, delay)
  );
}

async function loadEmployees() {
  const { data, error } = await getSupabaseAdmin().from("employees").select("id, american_name");
  if (error) throw new Error(error.message);
  return data || [];
}

async function attachmentEntryForRow(att) {
  const storagePath = att.dropboxPath;
  if (storagePath && saleStorage.isSupabaseStoragePath(storagePath)) {
    try {
      const signed = await saleStorage.createAirtableSyncUrl(storagePath);
      return { url: signed.url, filename: att.fileName || "attachment" };
    } catch (err) {
      console.warn(`[airtable] signed URL for ${att.fileName}: ${err.message}`);
    }
  }
  const url = att.dropboxLink || "";
  if (!url) return null;
  return { url, filename: att.fileName || "attachment" };
}

async function attachmentUrlsForKind(attachments, kind) {
  const rows = (attachments || []).filter((a) => a.kind === kind);
  const entries = await Promise.all(rows.map((att) => attachmentEntryForRow(att)));
  return entries.filter(Boolean);
}

async function buildAirtableFields(sale, employees, attachments) {
  const fields = fieldMap.buildSaleFieldsForAirtable(sale, employees);
  const columns = Object.entries(fieldMap.KIND_TO_ATTACHMENT_COLUMN).filter(
    ([kind]) => !fieldMap.SKIP_ATTACHMENT_KINDS?.has(kind)
  );
  await Promise.all(
    columns.map(async ([kind, column]) => {
      const urls = await attachmentUrlsForKind(attachments, kind);
      if (urls.length) fields[column] = urls;
    })
  );
  return fields;
}

async function setSyncMeta(saleId, { recordId, syncedAt, error }) {
  await business.setSaleAirtableMeta(saleId, { recordId, syncedAt, error });
}

async function resolveAirtableRecordId(sale, { skipStored = false } = {}) {
  if (!skipStored && sale.airtableRecordId) return sale.airtableRecordId;
  const portalField = fieldMap.PORTAL_SALE_ID_FIELD;
  if (!portalField || !sale.id) return null;
  const matches = await airtable.findAllRecordsByField(portalField, sale.id);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0].id;
  const keepId = sale.airtableRecordId && matches.some((m) => m.id === sale.airtableRecordId)
    ? sale.airtableRecordId
    : matches[0].id;
  const dupIds = matches.map((m) => m.id).filter((id) => id !== keepId);
  if (dupIds.length) {
    console.warn(`[airtable] removing ${dupIds.length} duplicate row(s) for sale ${sale.id}`);
    await airtable.deleteRecordsBatch(dupIds);
  }
  return keepId;
}

async function upsertAirtableRecord(sale, fields) {
  let recordId = await resolveAirtableRecordId(sale);
  if (recordId && !sale.airtableRecordId) {
    await setSyncMeta(sale.id, { recordId, error: null });
  }
  try {
    if (recordId) {
      await airtable.updateRecord(recordId, fields);
    } else {
      const portalField = fieldMap.PORTAL_SALE_ID_FIELD;
      if (portalField && sale.id) {
        const existing = await airtable.findAllRecordsByField(portalField, sale.id);
        if (existing.length) {
          recordId = existing[0].id;
          const dupIds = existing.slice(1).map((r) => r.id);
          if (dupIds.length) await airtable.deleteRecordsBatch(dupIds);
          await airtable.updateRecord(recordId, fields);
          return recordId;
        }
      }
      recordId = await airtable.createRecord(fields);
    }
    return recordId;
  } catch (err) {
    if (recordId && err.status === 404) {
      const found = await resolveAirtableRecordId(sale, { skipStored: true });
      if (found) {
        await airtable.updateRecord(found, fields);
        return found;
      }
      return airtable.createRecord(fields);
    }
    throw err;
  }
}

async function deleteSaleFromAirtable(sale) {
  if (!airtable.isConfigured()) return { skipped: true };
  const recordId = await resolveAirtableRecordId(sale);
  if (!recordId) {
    throw new Error("Airtable row not found for this sale (Portal Sale ID lookup failed)");
  }
  await airtable.deleteRecord(recordId);
  return { recordId };
}

function cancelSaleSync(saleId) {
  const key = String(saleId || "");
  if (!key) return;
  if (pendingTimers.has(key)) {
    clearTimeout(pendingTimers.get(key));
    pendingTimers.delete(key);
  }
  inflight.delete(key);
}

async function syncSaleById(saleId) {
  if (!airtable.isConfigured()) return;
  const key = String(saleId);
  if (inflight.has(key)) {
    scheduleSaleSync(key);
    return;
  }
  inflight.add(key);
  try {
    const sale = await business.getSale(key);
    if (!sale) return;

    const [employees, attachments] = await Promise.all([
      loadEmployees(),
      business.readSaleAttachments(key),
    ]);
    const fields = await buildAirtableFields(sale, employees, attachments);
    const recordId = await upsertAirtableRecord(sale, fields);
    await setSyncMeta(key, {
      recordId,
      syncedAt: new Date().toISOString(),
      error: null,
    });
  } catch (err) {
    await setSyncMeta(key, { error: err.message });
    throw err;
  } finally {
    inflight.delete(key);
  }
}

module.exports = {
  scheduleSaleSync,
  cancelSaleSync,
  syncSaleById,
  deleteSaleFromAirtable,
  buildAirtableFields,
  resolveAirtableRecordId,
  upsertAirtableRecord,
};
