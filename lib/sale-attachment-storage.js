/**
 * Dropbox-only sale attachment import (URL → Dropbox via save_url, no local download).
 */
const dropbox = require("./dropbox");

let dropboxReady = null;

async function ensureDropboxReady() {
  if (dropboxReady !== null) return dropboxReady;
  if (!dropbox.isConfigured()) {
    dropboxReady = false;
    throw new Error("DROPBOX_ACCESS_TOKEN not set. Enable files.content.write + sharing.write, regenerate token.");
  }
  const check = await dropbox.verifyAccess();
  dropboxReady = Boolean(check.ok);
  if (!check.ok) {
    throw new Error(`${check.error || "Dropbox not ready"}. ${check.hint || ""}`.trim());
  }
  return dropboxReady;
}

function resetDropboxCache() {
  dropboxReady = null;
}

/** Import from Airtable/HTTPS URL straight into Dropbox (server-side fetch by Dropbox). */
async function importSaleAttachmentFromUrl({ saleId, kind, fileName, sourceUrl }) {
  await ensureDropboxReady();
  const result = await dropbox.importSaleFileFromUrl({ saleId, kind, fileName, sourceUrl });
  await dropbox.confirmFileExists(result.dropboxPath);
  if (!result.dropboxLink) {
    result.dropboxLink = await dropbox.ensureSharedLink(result.dropboxPath);
  }
  return result;
}

/** User-selected file upload (buffer from app). */
async function uploadSaleAttachmentBuffer({ saleId, kind, fileName, buffer }) {
  await ensureDropboxReady();
  const up = await dropbox.uploadSaleFile({ saleId, kind, fileName, buffer });
  await dropbox.confirmFileExists(up.dropboxPath);
  const dropboxLink = up.dropboxLink || (await dropbox.ensureSharedLink(up.dropboxPath));
  return {
    backend: "dropbox",
    dropboxPath: up.dropboxPath,
    fileName: up.fileName || fileName,
    dropboxLink: dropboxLink || null,
  };
}

module.exports = {
  ensureDropboxReady,
  resetDropboxCache,
  importSaleAttachmentFromUrl,
  uploadSaleAttachmentBuffer,
};
