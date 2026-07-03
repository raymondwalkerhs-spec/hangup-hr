/**
 * Sale attachments — Supabase Storage only.
 */
const storage = require("./storage");
const { getSupabaseAdmin } = require("./supabase-client");
const { guessMime } = require("./sale-attachment-cache");

const BUCKET = storage.BUCKET;
const SHARE_TTL_SEC = Number(process.env.SALE_ATTACHMENT_SHARE_TTL_SEC || 60 * 60 * 24 * 7);

function isSupabaseStoragePath(storagePath) {
  return String(storagePath || "").startsWith("sales-attachments/");
}

function saleObjectPath(saleId, kind, fileName) {
  const safeKind = String(kind || "recording").replace(/[^a-z0-9_-]/gi, "");
  const safeName = String(fileName || "file").replace(/[^\w.\-() ]+/g, "_");
  return `sales-attachments/${saleId}/${safeKind}/${Date.now()}-${safeName}`;
}

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

async function createShareUrl(storagePath) {
  if (!isSupabaseStoragePath(storagePath)) {
    throw new Error("Attachment is not in Supabase storage. Run scripts/migrate-sale-attachments-to-supabase.js");
  }
  const { url, expiresInSeconds } = await storage.createSignedUrl(storagePath, SHARE_TTL_SEC);
  if (!url) throw new Error("Could not create share URL");
  return { url, expiresInSeconds, expiresInDays: Math.round(expiresInSeconds / 86400) };
}

async function uploadSaleAttachmentBuffer({ saleId, kind, fileName, buffer }) {
  if (!isConfigured()) throw new Error("Supabase not configured");
  const objectPath = saleObjectPath(saleId, kind, fileName);
  const mimeType = guessMime(fileName);
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).upload(objectPath, buffer, {
    upsert: true,
    contentType: mimeType,
  });
  if (error) throw new Error(`Storage upload: ${error.message}`);

  const { url } = await createShareUrl(objectPath);
  return {
    backend: "supabase",
    storagePath: objectPath,
    dropboxPath: objectPath,
    fileName: fileName || "attachment",
    dropboxLink: url,
    shareLink: url,
  };
}

async function importSaleAttachmentFromUrl({ saleId, kind, fileName, sourceUrl }) {
  const { fetchUrl } = require("./url-fetch");
  const { buffer } = await fetchUrl(sourceUrl);
  return uploadSaleAttachmentBuffer({ saleId, kind, fileName, buffer });
}

async function deleteSaleAttachmentFile(storagePath) {
  if (!storagePath) return;
  if (!isSupabaseStoragePath(storagePath)) {
    throw new Error("Cannot delete legacy attachment path — migrate to Supabase first");
  }
  await storage.deleteStorageFile(storagePath);
}

async function ensureDropboxReady() {
  if (!isConfigured()) throw new Error("Supabase storage not configured (SUPABASE_URL + SUPABASE_SECRET_KEY)");
}

module.exports = {
  isConfigured,
  isSupabaseStoragePath,
  createShareUrl,
  uploadSaleAttachmentBuffer,
  importSaleAttachmentFromUrl,
  deleteSaleAttachmentFile,
  ensureDropboxReady,
  SHARE_TTL_SEC,
};
