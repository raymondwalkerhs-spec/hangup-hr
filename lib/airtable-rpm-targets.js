/**
 * RPM Airtable targets (separate base from MLA).
 */
const { createAirtableTarget, rpmApiKey } = require("./airtable-client");
const {
  RPM_SALES_TABLE_NAME,
  Q_FEEDBACK_TABLE_NAME,
  NQ_CHECKS_TABLE_NAME,
} = require("./airtable-rpm-canonical-columns");

function rpmSyncFromApp() {
  return String(process.env.AIRTABLE_RPM_SYNC_FROM_APP || "").toLowerCase() === "true";
}

function rpmSyncEnabled() {
  return String(process.env.AIRTABLE_RPM_SYNC_ENABLED ?? "true").toLowerCase() !== "false";
}

function rpmBaseId() {
  return String(process.env.AIRTABLE_RPM_BASE_ID || "").trim();
}

function rpmSalesTableName() {
  return String(process.env.AIRTABLE_RPM_SALES_TABLE_NAME || RPM_SALES_TABLE_NAME).trim();
}

function rpmQFeedbackTableName() {
  return String(process.env.AIRTABLE_RPM_QFEEDBACK_TABLE_NAME || Q_FEEDBACK_TABLE_NAME).trim();
}

function rpmNqChecksTableName() {
  return String(process.env.AIRTABLE_RPM_NQ_TABLE_NAME || NQ_CHECKS_TABLE_NAME).trim();
}

function rpmWorkspaceId() {
  return String(process.env.AIRTABLE_RPM_WORKSPACE_ID || "wspElJw1rTpyIogEE").trim();
}

function rpmToken() {
  // AIRTABLE_RPM_TOKEN is optional. The MLA PAT already has Hangup RPM (app8havvaCHVAcccq);
  // the dedicated RPM PAT currently lists other bases only (Telemed HS / HS 1B / Main Internal).
  const mla = String(process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PAT || "").trim();
  return mla || rpmApiKey();
}

const rpmSales = createAirtableTarget({
  getBaseId: rpmBaseId,
  getTableName: rpmSalesTableName,
  getEnabled: rpmSyncEnabled,
  getApiKey: rpmToken,
  typecast: true,
});

const rpmQFeedback = createAirtableTarget({
  getBaseId: rpmBaseId,
  getTableName: rpmQFeedbackTableName,
  getEnabled: rpmSyncEnabled,
  getApiKey: rpmToken,
  typecast: true,
});

const rpmNqChecks = createAirtableTarget({
  getBaseId: rpmBaseId,
  getTableName: rpmNqChecksTableName,
  getEnabled: rpmSyncEnabled,
  getApiKey: rpmToken,
  typecast: true,
});

function isRpmConfigured() {
  return rpmSales.isConfigured();
}

module.exports = {
  rpmSyncEnabled,
  rpmSyncFromApp,
  rpmBaseId,
  rpmSalesTableName,
  rpmQFeedbackTableName,
  rpmNqChecksTableName,
  rpmWorkspaceId,
  rpmToken,
  rpmSales,
  rpmQFeedback,
  rpmNqChecks,
  isRpmConfigured,
};
