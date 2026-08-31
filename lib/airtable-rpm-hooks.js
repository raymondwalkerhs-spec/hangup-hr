/** Fail-open. Live Airtable sync is owned by Supabase (Edge Function), not the desktop app. */
async function afterRpmSaleWrite(saleId, opts) {
  if (opts?.skipAirtable || !saleId) return;
  if (!require("./airtable-rpm-targets").rpmSyncFromApp()) return;
  try {
    await require("./airtable-rpm-sales-sync").syncRpmSaleById(saleId);
  } catch (err) {
    console.error("[airtable-rpm] sale hook:", err.message);
  }
}

async function afterRpmSaleDelete(sale, opts) {
  if (opts?.skipAirtable || !sale?.id) return;
  if (!require("./airtable-rpm-targets").rpmSyncFromApp()) return;
  try {
    const salesSync = require("./airtable-rpm-sales-sync");
    salesSync.cancelRpmSaleSync(sale.id);
    await salesSync.deleteRpmSaleFromAirtable(sale);
  } catch (err) {
    console.error("[airtable-rpm] sale delete hook:", err.message);
  }
}

async function afterRpmCheckWrite(checkId, opts) {
  if (opts?.skipAirtable || !checkId) return;
  if (!require("./airtable-rpm-targets").rpmSyncFromApp()) return;
  try {
    await require("./airtable-rpm-check-sync").syncRpmCheckById(checkId);
  } catch (err) {
    console.error("[airtable-rpm] check hook:", err.message);
  }
}

async function afterRpmCheckDelete(check, opts) {
  if (opts?.skipAirtable || !check?.id) return;
  if (!require("./airtable-rpm-targets").rpmSyncFromApp()) return;
  try {
    const qSync = require("./airtable-rpm-qfeedback-sync");
    qSync.cancelQFeedbackSync(check.id);
    await require("./airtable-rpm-check-sync").deleteRpmCheckFromAirtable(check);
  } catch (err) {
    console.error("[airtable-rpm] check delete hook:", err.message);
  }
}

/** @deprecated use afterRpmCheckWrite */
const afterQFeedbackWrite = afterRpmCheckWrite;
/** @deprecated use afterRpmCheckDelete */
const afterQFeedbackDelete = afterRpmCheckDelete;

module.exports = {
  afterRpmSaleWrite,
  afterRpmSaleDelete,
  afterRpmCheckWrite,
  afterRpmCheckDelete,
  afterQFeedbackWrite,
  afterQFeedbackDelete,
};
