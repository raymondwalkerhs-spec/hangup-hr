const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("./supabase-client");

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "hr-documents";

function admin() {
  return getSupabaseAdmin();
}

function storagePath(employeeId, fileName, kind = "documents") {
  const safeName = String(fileName || "file").replace(/[^\w.\-() ]+/g, "_");
  return `${kind}/${employeeId}/${Date.now()}-${safeName}`;
}

async function uploadFile({ employeeId, filePath, fileName, kind = "documents" }) {
  const objectPath = storagePath(employeeId, fileName, kind);
  const body = fs.readFileSync(filePath);
  return uploadBuffer({ employeeId, fileName, kind, buffer: body });
}

async function uploadBuffer({ employeeId, fileName, kind = "documents", buffer, mimeType }) {
  const objectPath = storagePath(employeeId, fileName, kind);
  const { error } = await admin().storage.from(BUCKET).upload(objectPath, buffer, {
    upsert: true,
    contentType: mimeType || guessMime(fileName),
  });
  if (error) throw new Error(`Storage upload: ${error.message}`);

  const { data: signed } = await admin().storage.from(BUCKET).createSignedUrl(objectPath, 60 * 60 * 24 * 7);
  return {
    storagePath: objectPath,
    publicUrl: signed?.signedUrl || "",
    fileId: objectPath,
    link: signed?.signedUrl || "",
  };
}

async function deleteStorageFile(storagePath) {
  if (!storagePath) return;
  try {
    await admin().storage.from(BUCKET).remove([storagePath]);
  } catch {
    /* ignore */
  }
}

async function getStorageFileStream(storagePath) {
  const { data, error } = await admin().storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(`Storage download: ${error.message}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  return {
    stream: require("stream").Readable.from(buffer),
    mimeType: guessMime(storagePath),
  };
}

function guessMime(fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  const map = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || "application/octet-stream";
}

/** Signed URL for sharing (default 7 days; regenerate anytime via Share link). */
async function createSignedUrl(storagePath, expiresInSeconds) {
  const ttl = Number(expiresInSeconds || process.env.SALE_ATTACHMENT_SHARE_TTL_SEC || 60 * 60 * 24 * 7);
  const { data, error } = await admin().storage.from(BUCKET).createSignedUrl(storagePath, ttl);
  if (error) throw new Error(`Storage signed URL: ${error.message}`);
  return { url: data?.signedUrl || "", expiresInSeconds: ttl };
}

module.exports = {
  BUCKET,
  uploadFile,
  uploadBuffer,
  deleteStorageFile,
  getStorageFileStream,
  guessMime,
  createSignedUrl,
};
