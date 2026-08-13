/**
 * MLA vs RPM sales program — separate DB tables and Supabase Storage roots.
 * Quality records live under `{prefix}/{saleId}/quality_record/…` per program.
 */
const QUALITY_RECORD_KIND = "quality_record";

const MLA_STORAGE_PREFIX = "mla-sales-attachments";
/** Legacy MLA uploads before program split naming */
const MLA_STORAGE_LEGACY_PREFIX = "sales-attachments";
const RPM_STORAGE_PREFIX = "rpm-sales-attachments";

const MLA_TABLES = {
  program: "mla",
  sales: "sales",
  attachments: "sales_attachments",
  fieldPermissions: "sales_field_permissions",
  attachmentPermissions: "sales_attachment_permissions",
  actionPermissions: "sales_action_permissions",
  listColumnConfig: "sales_list_column_config",
};

const RPM_TABLES = {
  program: "rpm",
  sales: "rpm_sales",
  attachments: "rpm_sales_attachments",
  fieldPermissions: "rpm_sales_field_permissions",
  attachmentPermissions: "rpm_sales_attachment_permissions",
  actionPermissions: "rpm_sales_action_permissions",
  listColumnConfig: "rpm_sales_list_column_config",
};

const MLA_ATTACHMENT_KINDS = ["recording", "raw_call", "quality_record", "confirmation", "receipt"];
const RPM_ATTACHMENT_KINDS = ["recording", "quality_record", "raw_call"];

function safeKind(kind) {
  return String(kind || "recording").replace(/[^a-z0-9_-]/gi, "");
}

function safeFileName(fileName) {
  return String(fileName || "file").replace(/[^\w.\-() ]+/g, "_");
}

function isMlaStoragePath(storagePath) {
  const p = String(storagePath || "");
  return p.startsWith(`${MLA_STORAGE_PREFIX}/`) || p.startsWith(`${MLA_STORAGE_LEGACY_PREFIX}/`);
}

function isRpmStoragePath(storagePath) {
  return String(storagePath || "").startsWith(`${RPM_STORAGE_PREFIX}/`);
}

function isSaleProgramStoragePath(storagePath) {
  return isMlaStoragePath(storagePath) || isRpmStoragePath(storagePath);
}

function saleProgramFromStoragePath(storagePath) {
  if (isRpmStoragePath(storagePath)) return "rpm";
  if (isMlaStoragePath(storagePath)) return "mla";
  return null;
}

function buildObjectPath(program, saleId, kind, fileName) {
  const prefix = program === "rpm" ? RPM_STORAGE_PREFIX : MLA_STORAGE_PREFIX;
  return `${prefix}/${saleId}/${safeKind(kind)}/${Date.now()}-${safeFileName(fileName)}`;
}

function qualityRecordFolder(program, saleId) {
  const prefix = program === "rpm" ? RPM_STORAGE_PREFIX : MLA_STORAGE_PREFIX;
  return `${prefix}/${saleId}/${QUALITY_RECORD_KIND}`;
}

function mlaSaleObjectPath(saleId, kind, fileName) {
  return buildObjectPath("mla", saleId, kind, fileName);
}

function rpmSaleObjectPath(saleId, kind, fileName) {
  return buildObjectPath("rpm", saleId, kind, fileName);
}

module.exports = {
  QUALITY_RECORD_KIND,
  MLA_STORAGE_PREFIX,
  MLA_STORAGE_LEGACY_PREFIX,
  RPM_STORAGE_PREFIX,
  MLA_TABLES,
  RPM_TABLES,
  MLA_ATTACHMENT_KINDS,
  RPM_ATTACHMENT_KINDS,
  isMlaStoragePath,
  isRpmStoragePath,
  isSaleProgramStoragePath,
  saleProgramFromStoragePath,
  buildObjectPath,
  qualityRecordFolder,
  mlaSaleObjectPath,
  rpmSaleObjectPath,
};
