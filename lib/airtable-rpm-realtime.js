/**
 * Optional desktop-app Airtable writer. Live sync is owned by Supabase
 * (trigger + Edge Function). Enable only with AIRTABLE_RPM_SYNC_FROM_APP=true.
 */
const { isRpmConfigured, rpmSyncFromApp } = require("./airtable-rpm-targets");
const { getSupabaseAdmin, isSupabaseConfigured, hasSupabaseAdminKey } = require("./supabase-client");

let channel = null;
let started = false;

function businessUpdatedAfterSync(row) {
  const updated = Date.parse(row?.updated_at || 0);
  const synced = Date.parse(row?.airtable_synced_at || 0);
  if (!Number.isFinite(updated)) return true;
  if (!Number.isFinite(synced)) return true;
  return updated > synced;
}

function saleIdFromPayload(payload) {
  const event = payload?.eventType;
  const row = event === "DELETE" ? payload.old : payload.new;
  return row?.id || null;
}

function checkIdFromPayload(payload) {
  const event = payload?.eventType;
  const row = event === "DELETE" ? payload.old : payload.new;
  return row?.id || null;
}

function parentSaleIdFromAttachment(payload) {
  const neu = payload?.new || {};
  const old = payload?.old || {};
  return neu.rpm_sale_id || old.rpm_sale_id || neu.rpmSaleId || old.rpmSaleId || null;
}

async function onSaleChange(payload) {
  const event = payload?.eventType;
  const hooks = require("./airtable-rpm-hooks");
  if (event === "DELETE") {
    const row = payload.old || {};
    if (!row.id) return;
    await hooks.afterRpmSaleDelete({
      id: row.id,
      airtableRecordId: row.airtable_record_id || "",
    });
    return;
  }
  const row = payload.new || {};
  if (!row.id) return;
  if (event === "UPDATE" && !businessUpdatedAfterSync(row)) return;
  await hooks.afterRpmSaleWrite(row.id);
}

async function onCheckChange(payload) {
  const event = payload?.eventType;
  const hooks = require("./airtable-rpm-hooks");
  if (event === "DELETE") {
    const row = payload.old || {};
    if (!row.id) return;
    await hooks.afterRpmCheckDelete({
      id: row.id,
      airtableRecordId: row.airtable_record_id || "",
    });
    return;
  }
  const row = payload.new || {};
  if (!row.id) return;
  if (event === "UPDATE" && !businessUpdatedAfterSync(row)) return;
  await hooks.afterRpmCheckWrite(row.id);
}

async function onAttachmentChange(payload) {
  const saleId = parentSaleIdFromAttachment(payload);
  if (!saleId) return;
  await require("./airtable-rpm-hooks").afterRpmSaleWrite(saleId);
}

function handle(kind, payload) {
  const run =
    kind === "sale" ? onSaleChange(payload) : kind === "check" ? onCheckChange(payload) : onAttachmentChange(payload);
  Promise.resolve(run).catch((err) => {
    console.error(`[airtable-rpm] realtime ${kind}:`, err.message);
  });
}

async function ensureStarted() {
  if (started) return started;
  started = true;
  if (!rpmSyncFromApp()) return false;
  if (!isRpmConfigured()) return false;
  if (!isSupabaseConfigured() || !hasSupabaseAdminKey()) {
    console.warn("[airtable-rpm] realtime skipped — Supabase admin not configured");
    return false;
  }
  try {
    require("./airtable-rpm-catchup").startCatchUpLoop();
  } catch (err) {
    console.warn("[airtable-rpm] catch-up loop:", err.message);
  }
  try {
    const sb = getSupabaseAdmin();
    channel = sb
      .channel("hangup-airtable-rpm")
      .on("postgres_changes", { event: "*", schema: "public", table: "rpm_sales" }, (payload) =>
        handle("sale", payload)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "rpm_checks" }, (payload) =>
        handle("check", payload)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "rpm_sales_attachments" }, (payload) =>
        handle("attachment", payload)
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[airtable-rpm] realtime channel status:", status);
        }
      });
    console.log("[airtable-rpm] realtime subscription started (rpm_sales, rpm_checks, rpm_sales_attachments).");
    return true;
  } catch (err) {
    console.warn("[airtable-rpm] realtime failed to start:", err.message || err);
    return false;
  }
}

module.exports = {
  ensureStarted,
  businessUpdatedAfterSync,
  saleIdFromPayload,
  checkIdFromPayload,
  parentSaleIdFromAttachment,
};
