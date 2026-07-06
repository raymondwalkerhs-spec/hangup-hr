const path = require("path");
const storage = require("./storage");

const DOC_TYPES = [
  "National ID",
  "Contract",
  "Warning Letter",
  "Medical",
  "Medical Note",
  "Exam Note",
  "Training Certificate",
  "Other",
];

/** Self-service uploads (non-HR) — My docs on employee profile */
const SELF_UPLOAD_DOC_TYPES = ["National ID", "Medical Note", "Exam Note"];

const IMAGE_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function guessImageMime(fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  return IMAGE_MIME[ext] || "image/jpeg";
}

async function deleteDriveFile(fileId) {
  if (!fileId) return;
  return storage.deleteStorageFile(fileId);
}

async function getDriveFileStream(fileId) {
  return storage.getStorageFileStream(fileId);
}

async function uploadProfilePhoto({ employeeId, filePath, fileName, oldFileId }) {
  await deleteDriveFile(oldFileId);
  const uploaded = await storage.uploadFile({
    employeeId,
    filePath,
    fileName,
    kind: "profile-photos",
  });
  return {
    fileId: uploaded.storagePath,
    link: uploaded.link,
    mimeType: guessImageMime(fileName || filePath),
    storagePath: uploaded.storagePath,
  };
}

async function uploadEmployeeFile({ employeeId, docType, filePath, fileName, notes, expiry }) {
  const name = fileName || path.basename(filePath);
  const uploaded = await storage.uploadFile({ employeeId, filePath, fileName: name });
  return {
    employeeId,
    docType: docType || "Other",
    fileName: name,
    driveFileId: uploaded.storagePath,
    driveLink: uploaded.link,
    storagePath: uploaded.storagePath,
    uploadedAt: new Date().toISOString(),
    expiry: expiry || "",
    notes: notes || "",
  };
}

module.exports = {
  DOC_TYPES,
  SELF_UPLOAD_DOC_TYPES,
  uploadEmployeeFile,
  uploadProfilePhoto,
  getDriveFileStream,
  deleteDriveFile,
  guessImageMime,
};
