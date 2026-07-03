/**
 * On-demand sale attachment cache — 48 hours, only when user opens a file in the app.
 */
const fs = require("fs");
const path = require("path");
const { getCacheDir } = require("./cache");
const dropbox = require("./dropbox");

const CACHE_TTL_MS = 48 * 60 * 60 * 1000;

function cacheRoot() {
  const root = path.join(getCacheDir(), "sale-attachments");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function metaPath(attachmentId) {
  return path.join(cacheRoot(), `${attachmentId}.meta.json`);
}

function filePathFor(attachmentId, fileName) {
  const ext = path.extname(fileName || "") || "";
  return path.join(cacheRoot(), `${attachmentId}${ext}`);
}

function guessMime(fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  const map = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".mp4": "audio/mp4",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}

function readCached(attachmentId) {
  const mp = metaPath(attachmentId);
  if (!fs.existsSync(mp)) return null;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(mp, "utf8"));
  } catch {
    return null;
  }
  if (!meta.cachedAt || Date.now() - meta.cachedAt > CACHE_TTL_MS) {
    try {
      if (meta.filePath && fs.existsSync(meta.filePath)) fs.unlinkSync(meta.filePath);
      fs.unlinkSync(mp);
    } catch {
      /* ignore */
    }
    return null;
  }
  if (!meta.filePath || !fs.existsSync(meta.filePath)) return null;
  return meta;
}

async function getOrFetch(attachment) {
  const cached = readCached(attachment.id);
  if (cached) {
    return {
      filePath: cached.filePath,
      fileName: cached.fileName,
      mimeType: cached.mimeType || guessMime(cached.fileName),
      fromCache: true,
    };
  }

  const storagePath = attachment.dropboxPath || attachment.dropbox_path;
  if (!storagePath) throw new Error("Attachment has no storage path");

  let buffer;
  const isSupabase =
    String(storagePath).startsWith("sales-attachments/") ||
    !String(storagePath).startsWith("/");
  if (isSupabase) {
    const { getSupabaseAdmin } = require("./supabase-client");
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || "hr-documents";
    const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(storagePath);
    if (error) throw new Error(error.message);
    buffer = Buffer.from(await data.arrayBuffer());
  } else {
    buffer = await dropbox.downloadFile(storagePath);
  }

  const fileName = attachment.fileName || attachment.file_name || "attachment";
  const dest = filePathFor(attachment.id, fileName);
  fs.writeFileSync(dest, buffer);
  const meta = {
    attachmentId: attachment.id,
    fileName,
    filePath: dest,
    mimeType: guessMime(fileName),
    cachedAt: Date.now(),
  };
  fs.writeFileSync(metaPath(attachment.id), JSON.stringify(meta));
  return { filePath: dest, fileName, mimeType: meta.mimeType, fromCache: false };
}

function evict(attachmentId) {
  const mp = metaPath(attachmentId);
  try {
    const cached = readCached(attachmentId);
    if (cached?.filePath && fs.existsSync(cached.filePath)) fs.unlinkSync(cached.filePath);
    if (fs.existsSync(mp)) fs.unlinkSync(mp);
  } catch {
    /* ignore */
  }
}

module.exports = {
  CACHE_TTL_MS,
  getOrFetch,
  readCached,
  guessMime,
  evict,
};
