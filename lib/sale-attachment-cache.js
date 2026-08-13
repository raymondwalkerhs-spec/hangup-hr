/**
 * On-demand sale attachment cache — 48 hours, only when user opens a file in the app.
 */
const fs = require("fs");
const path = require("path");
const { getCacheDir } = require("./cache");

const programStorage = require("./sale-program-storage");

const CACHE_TTL_MS = 48 * 60 * 60 * 1000;

function cacheRoot(program = "mla") {
  const sub = program === "rpm" ? "rpm" : "mla";
  const root = path.join(getCacheDir(), "sale-attachments", sub);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function metaPath(attachmentId, program = "mla") {
  return path.join(cacheRoot(program), `${attachmentId}.meta.json`);
}

function filePathFor(attachmentId, fileName, program = "mla") {
  const ext = path.extname(fileName || "") || "";
  return path.join(cacheRoot(program), `${attachmentId}${ext}`);
}

function guessMime(fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  const map = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".flac": "audio/flac",
    ".wma": "audio/x-ms-wma",
    ".amr": "audio/amr",
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".3gp": "video/3gpp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}

function readCached(attachmentId, program = "mla") {
  const mp = metaPath(attachmentId, program);
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
  const storagePath = attachment.dropboxPath || attachment.dropbox_path;
  if (!storagePath) throw new Error("Attachment has no storage path");
  const program = programStorage.saleProgramFromStoragePath(storagePath) || "mla";
  if (!programStorage.isSaleProgramStoragePath(storagePath)) {
    throw new Error(
      "Attachment still on legacy storage. Ask admin to run scripts/migrate-sale-attachments-to-supabase.js"
    );
  }

  const cached = readCached(attachment.id, program);
  if (cached) {
    return {
      filePath: cached.filePath,
      fileName: cached.fileName,
      mimeType: cached.mimeType || guessMime(cached.fileName),
      fromCache: true,
    };
  }

  const { getSupabaseAdmin } = require("./supabase-client");
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "hr-documents";
  const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(storagePath);
  if (error) throw new Error(error.message);
  const buffer = Buffer.from(await data.arrayBuffer());

  const fileName = attachment.fileName || attachment.file_name || "attachment";
  const dest = filePathFor(attachment.id, fileName, program);
  fs.writeFileSync(dest, buffer);
  const meta = {
    attachmentId: attachment.id,
    fileName,
    filePath: dest,
    mimeType: guessMime(fileName),
    cachedAt: Date.now(),
    program,
  };
  fs.writeFileSync(metaPath(attachment.id, program), JSON.stringify(meta));
  return { filePath: dest, fileName, mimeType: meta.mimeType, fromCache: false };
}

function evict(attachmentId, program = "mla") {
  const mp = metaPath(attachmentId, program);
  try {
    const cached = readCached(attachmentId, program);
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
