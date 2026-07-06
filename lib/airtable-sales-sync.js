/**
 * Outbound sync: Supabase sales → Airtable "Sales All Data".
 * Fail-open: errors are logged and stored on the sale row; DB writes are never blocked.
 */
const airtable = require("./airtable-client");
const fieldMap = require("./airtable-sales-field-map");
const business = require("./business-repo");
const saleStorage = require("./sale-attachment-storage");
const { getSupabaseAdmin } = require("./supabase-client");

const DEBOUNCE_MS = Number(process.env.AIRTABLE_SYNC_DEBOUNCE_MS || 1500);
const pendingTimers = new Map();
const inflight = new Set();

function scheduleSaleSync(saleId) {
  if (!saleId || !airtable.isConfigured()) return;
  const key = String(saleId);
  if (pendingTimers.has(key)) clearTimeout(pendingTimers.get(key));
  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      syncSaleById(key).catch((err) => {
        console.error(`[airtable] sync failed for sale ${key}:`, err.message);
      });
    }, DEBOUNCE_MS)
  );
}

async function loadEmployees() {
  const { data, error } = await getSupabaseAdmin().from("employees").select("id, american_name");
  if (error) throw new Error(error.message);
  return data || [];
}

async function attachmentUrlsForKind(attachments, kind) {
  const rows = (attachments || []).filter((a) => a.kind === kind);
  const out = [];
  for (const att of rows) {
    const storagePath = att.dropboxPath;
    let url = att.dropboxLink || "";
    if (storagePath && saleStorage.isSupabaseStoragePath(storagePath)) {
      try {
        const signed = await saleStorage.createShareUrl(storagePath);
        url = signed.url;
      } catch (err) {
        console.warn(`[airtable] signed URL for ${att.fileName}: ${err.message}`);
      }
    }
    if (!url) continue;
    out.push({ url, filename: att.fileName || "attachment" });
  }
  return out;
}

async function buildAirtableFields(sale, employees, attachments) {
  const fields = fieldMap.buildSaleFieldsForAirtable(sale, employees);
  for (const [kind, column] of Object.entries(fieldMap.KIND_TO_ATTACHMENT_COLUMN)) {
    if (fieldMap.SKIP_ATTACHMENT_KINDS?.has(kind)) continue;
    const urls = await attachmentUrlsForKind(attachments, kind);
    if (urls.length) fields[column] = urls;
  }
  return fields;
}

async function setSyncMeta(saleId, { recordId, syncedAt, error }) {
  await business.setSaleAirtableMeta(saleId, { recordId, syncedAt, error });
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

    let recordId = sale.airtableRecordId || null;
    try {
      if (recordId) {
        await airtable.updateRecord(recordId, fields);
      } else {
        recordId = await airtable.createRecord(fields);
      }
      await setSyncMeta(key, {
        recordId,
        syncedAt: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      if (recordId && err.status === 404) {
        recordId = await airtable.createRecord(fields);
        await setSyncMeta(key, {
          recordId,
          syncedAt: new Date().toISOString(),
          error: null,
        });
        return;
      }
      await setSyncMeta(key, { error: err.message });
      throw err;
    }
  } finally {
    inflight.delete(key);
  }
}

module.exports = {
  scheduleSaleSync,
  syncSaleById,
  buildAirtableFields,
};
