/**
 * Outbound sync: completed rpm_checks Q Feedback → Airtable "Q Feedback".
 * Fail-open, immediate, upsert by Portal Check ID (never duplicate rows).
 */
const { rpmQFeedback, isRpmConfigured } = require("./airtable-rpm-targets");
const fieldMap = require("./airtable-rpm-qfeedback-field-map");
const { upsertByPortalId } = require("./airtable-upsert");
const rpmChecksRepo = require("./rpm-checks-repo");
const { getSupabaseAdmin } = require("./supabase-client");

const pendingTimers = new Map();
const inflight = new Map();
const pendingRerun = new Set();

function scheduleQFeedbackSync(checkId) {
  if (!checkId || !isRpmConfigured()) return;
  const key = String(checkId);
  if (pendingTimers.has(key)) clearTimeout(pendingTimers.get(key));
  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      syncQFeedbackById(key).catch((err) => {
        console.error(`[airtable-rpm] Q Feedback sync failed for ${key}:`, err.message);
      });
    }, 0)
  );
}

function cancelQFeedbackSync(checkId) {
  const key = String(checkId || "");
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

async function saleAirtableId(saleId) {
  if (!saleId) return "";
  const rpmRepo = require("./rpm-sales-repo");
  let sale = await rpmRepo.getRpmSale(saleId);
  if (!sale) return "";
  if (sale.airtableRecordId) return sale.airtableRecordId;
  try {
    const salesSync = require("./airtable-rpm-sales-sync");
    await salesSync.syncRpmSaleById(saleId);
    sale = await rpmRepo.getRpmSale(saleId);
  } catch (err) {
    console.warn(`[airtable-rpm] sale sync before Q link: ${err.message}`);
  }
  return sale?.airtableRecordId || "";
}

async function setSyncMeta(checkId, { recordId, syncedAt, error }) {
  await rpmChecksRepo.setRpmCheckAirtableMeta(checkId, { recordId, syncedAt, error });
}

async function deleteQFeedbackFromAirtable(check) {
  if (!isRpmConfigured() || !check?.id) return { skipped: true };
  const found = await rpmQFeedback.findAllRecordsByField(fieldMap.PORTAL_CHECK_ID_FIELD, check.id);
  if (!found.length) return { skipped: true, missing: true };
  await rpmQFeedback.deleteRecordsBatch(found.map((r) => r.id));
  return { recordId: found[0].id };
}

async function syncQFeedbackById(checkId) {
  if (!isRpmConfigured()) return;
  const key = String(checkId);
  if (inflight.has(key)) {
    pendingRerun.add(key);
    return inflight.get(key);
  }
  const run = (async () => {
    try {
      const { check } = await rpmChecksRepo.getCheckById(key);
      if (!check) return;

      if (!fieldMap.isCompletedFeedback(check.feedbackStatus)) {
        if (check.airtableRecordId) await deleteQFeedbackFromAirtable(check);
        else {
          const found = await rpmQFeedback.findAllRecordsByField(fieldMap.PORTAL_CHECK_ID_FIELD, check.id);
          if (found.length) await deleteQFeedbackFromAirtable({ ...check, airtableRecordId: found[0].id });
        }
        return;
      }

      const employees = await loadEmployees();
      const saleRec = await saleAirtableId(check.linkedRpmSaleId);
      const fields = fieldMap.buildQFeedbackFieldsForAirtable(check, employees, {
        saleAirtableRecordId: saleRec,
      });
      const recordId = await upsertByPortalId(rpmQFeedback, {
        storedRecordId: check.airtableRecordId,
        portalField: fieldMap.PORTAL_CHECK_ID_FIELD,
        portalId: check.id,
        fields,
        logPrefix: "[airtable-rpm-q]",
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
        await syncQFeedbackById(key);
      }
    }
  })();
  inflight.set(key, run);
  return run;
}

module.exports = {
  scheduleQFeedbackSync,
  cancelQFeedbackSync,
  syncQFeedbackById,
  deleteQFeedbackFromAirtable,
};
