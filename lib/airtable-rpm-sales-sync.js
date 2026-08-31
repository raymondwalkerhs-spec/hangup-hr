/**
 * Outbound sync: Supabase rpm_sales → Airtable "RPM Sales".
 * Fail-open, immediate, upsert by Portal Sale ID (never duplicate rows).
 */
const { rpmSales, isRpmConfigured } = require("./airtable-rpm-targets");
const fieldMap = require("./airtable-rpm-sales-field-map");
const { upsertByPortalId, resolveRecordId } = require("./airtable-upsert");
const rpmRepo = require("./rpm-sales-repo");
const saleStorage = require("./sale-attachment-storage");
const { getSupabaseAdmin } = require("./supabase-client");

const pendingTimers = new Map();
const inflight = new Map();
const pendingRerun = new Set();

function scheduleRpmSaleSync(saleId) {
  if (!saleId || !isRpmConfigured()) return;
  const key = String(saleId);
  if (pendingTimers.has(key)) clearTimeout(pendingTimers.get(key));
  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      syncRpmSaleById(key).catch((err) => {
        console.error(`[airtable-rpm] sync failed for sale ${key}:`, err.message);
      });
    }, 0)
  );
}

function cancelRpmSaleSync(saleId) {
  const key = String(saleId || "");
  if (!key) return;
  if (pendingTimers.has(key)) {
    clearTimeout(pendingTimers.get(key));
    pendingTimers.delete(key);
  }
  pendingRerun.delete(key);
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
      console.warn(`[airtable-rpm] signed URL for ${att.fileName}: ${err.message}`);
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

async function findLinkedCheckId(saleId) {
  try {
    const rpmChecksRepo = require("./rpm-checks-repo");
    const checks = await rpmChecksRepo.listChecksLinkedToSale(saleId);
    return checks[0]?.id || "";
  } catch {
    return "";
  }
}

async function buildAirtableFields(sale, employees, attachments, linkedCheckId) {
  const fields = fieldMap.buildRpmSaleFieldsForAirtable(sale, employees, { linkedCheckId });
  await Promise.all(
    Object.entries(fieldMap.RPM_SALES_ATTACHMENT_COLUMNS).map(async ([kind, column]) => {
      fields[column] = await attachmentUrlsForKind(attachments, kind);
    })
  );
  return fields;
}

async function setSyncMeta(saleId, { recordId, syncedAt, error }) {
  await rpmRepo.setRpmSaleAirtableMeta(saleId, { recordId, syncedAt, error });
}

async function syncRpmSaleById(saleId) {
  if (!isRpmConfigured()) return;
  const key = String(saleId);
  if (inflight.has(key)) {
    pendingRerun.add(key);
    return inflight.get(key);
  }
  const run = (async () => {
    try {
      const sale = await rpmRepo.getRpmSale(key);
      if (!sale) return;

      const [employees, attachments, linkedCheckId] = await Promise.all([
        loadEmployees(),
        rpmRepo.readRpmSaleAttachments(key),
        findLinkedCheckId(key),
      ]);
      const fields = await buildAirtableFields(sale, employees, attachments, linkedCheckId);
      const recordId = await upsertByPortalId(rpmSales, {
        storedRecordId: sale.airtableRecordId,
        portalField: fieldMap.PORTAL_SALE_ID_FIELD,
        portalId: sale.id,
        fields,
        logPrefix: "[airtable-rpm]",
      });
      await setSyncMeta(key, {
        recordId,
        syncedAt: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      await setSyncMeta(key, { error: err.message }).catch(() => {});
      throw err;
    } finally {
      inflight.delete(key);
      if (pendingRerun.has(key)) {
        pendingRerun.delete(key);
        await syncRpmSaleById(key);
      }
    }
  })();
  inflight.set(key, run);
  return run;
}

async function deleteRpmSaleFromAirtable(sale) {
  if (!isRpmConfigured()) return { skipped: true };
  const recordId = await resolveRecordId(rpmSales, {
    storedRecordId: sale.airtableRecordId,
    portalField: fieldMap.PORTAL_SALE_ID_FIELD,
    portalId: sale.id,
    logPrefix: "[airtable-rpm]",
  });
  if (!recordId) return { skipped: true, missing: true };
  await rpmSales.deleteRecord(recordId);
  return { recordId };
}

module.exports = {
  scheduleRpmSaleSync,
  cancelRpmSaleSync,
  syncRpmSaleById,
  deleteRpmSaleFromAirtable,
  buildAirtableFields,
};
