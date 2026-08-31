/**
 * Outbound sync: NQ / Age limit / Duplicate / Under Age → Airtable "NQ Checks".
 */
const { rpmNqChecks, isRpmConfigured } = require("./airtable-rpm-targets");
const fieldMap = require("./airtable-rpm-nq-field-map");
const { upsertByPortalId } = require("./airtable-upsert");
const rpmChecksRepo = require("./rpm-checks-repo");
const { getSupabaseAdmin } = require("./supabase-client");

const inflight = new Map();
const pendingRerun = new Set();

async function loadEmployees() {
  const { data, error } = await getSupabaseAdmin().from("employees").select("id, american_name");
  if (error) throw new Error(error.message);
  return data || [];
}

async function setSyncMeta(checkId, { recordId, syncedAt, error }) {
  await rpmChecksRepo.setRpmCheckAirtableMeta(checkId, { recordId, syncedAt, error });
}

async function deleteNqCheckFromAirtable(check) {
  if (!isRpmConfigured() || !check?.id) return { skipped: true };
  const found = await rpmNqChecks.findAllRecordsByField(fieldMap.PORTAL_CHECK_ID_FIELD, check.id);
  if (!found.length) return { skipped: true, missing: true };
  await rpmNqChecks.deleteRecordsBatch(found.map((r) => r.id));
  return { recordId: found[0].id };
}

async function syncNqCheckById(checkId) {
  if (!isRpmConfigured()) return;
  const key = String(checkId);
  if (inflight.has(key)) {
    pendingRerun.add(key);
    return inflight.get(key);
  }
  const run = (async () => {
    try {
      const { check } = await rpmChecksRepo.getCheckById(key);
      if (!check || check.deletedAt) {
        if (check) await deleteNqCheckFromAirtable(check);
        return;
      }
      if (!fieldMap.isNqFamilyCheck(check.checkStatus)) {
        await deleteNqCheckFromAirtable(check);
        return;
      }
      if (!fieldMap.hasFormPhone(check.phone || check.phoneNormalized)) {
        await deleteNqCheckFromAirtable(check);
        await setSyncMeta(key, { recordId: null, syncedAt: new Date().toISOString(), error: null });
        return;
      }
      const employees = await loadEmployees();
      const fields = fieldMap.buildNqCheckFieldsForAirtable(check, employees);
      const recordId = await upsertByPortalId(rpmNqChecks, {
        storedRecordId: null,
        portalField: fieldMap.PORTAL_CHECK_ID_FIELD,
        portalId: check.id,
        fields,
        logPrefix: "[airtable-rpm-nq]",
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
        await syncNqCheckById(key);
      }
    }
  })();
  inflight.set(key, run);
  return run;
}

module.exports = {
  syncNqCheckById,
  deleteNqCheckFromAirtable,
};
