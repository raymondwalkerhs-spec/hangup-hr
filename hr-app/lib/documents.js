const fs = require("fs");
const path = require("path");
const { getDriveAuth, getDriveClient } = require("./google-auth");
const { useSupabase } = require("./backend");
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

const DEFAULT_DRIVE_FOLDER_ID = "1rfPMKlIqbJ_eKpwXIpHPKW_vfR7VXVUe";
const PROFILE_PHOTOS_FOLDER_NAME = "Profile Photos";

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

async function getOrCreateFolder() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_DRIVE_FOLDER_ID;
  if (folderId) return folderId;

  const auth = await getDriveAuth();
  const drive = getDriveClient(auth);
  const name = process.env.GOOGLE_DRIVE_FOLDER_NAME || "Hangup HR Documents";
  const q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
  const existing = await drive.files.list({
    q,
    fields: "files(id)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (existing.data.files?.length) return existing.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder" },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id;
}

async function getOrCreateProfilePhotosFolder() {
  const parentId = await getOrCreateFolder();
  const auth = await getDriveAuth();
  const drive = getDriveClient(auth);
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${PROFILE_PHOTOS_FOLDER_NAME}'`,
    `'${parentId}' in parents`,
    "trashed=false",
  ].join(" and ");
  const existing = await drive.files.list({
    q,
    fields: "files(id)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (existing.data.files?.length) return existing.data.files[0].id;

  const created = await drive.files.create({
    requestBody: {
      name: PROFILE_PHOTOS_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });
  return created.data.id;
}

async function deleteDriveFile(fileId) {
  if (!fileId) return;
  if (useSupabase()) {
    return storage.deleteStorageFile(fileId);
  }
  try {
    const auth = await getDriveAuth();
    const drive = getDriveClient(auth);
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch {
    /* ignore */
  }
}

async function getDriveFileStream(fileId) {
  if (useSupabase()) {
    return storage.getStorageFileStream(fileId);
  }
  const auth = await getDriveAuth();
  const drive = getDriveClient(auth);
  const meta = await drive.files.get({ fileId, fields: "mimeType, name", supportsAllDrives: true });
  const media = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  return { stream: media.data, mimeType: meta.data.mimeType || "image/jpeg" };
}

async function uploadProfilePhoto({ employeeId, filePath, fileName, oldFileId }) {
  if (useSupabase()) {
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
  const auth = await getDriveAuth();
  const drive = getDriveClient(auth);
  const folderId = await getOrCreateProfilePhotosFolder();
  const mimeType = guessImageMime(fileName || filePath);
  const ext = path.extname(fileName || filePath) || ".jpg";

  await deleteDriveFile(oldFileId);

  const uploaded = await drive.files.create({
    requestBody: {
      name: `${employeeId}-profile${ext}`,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: fs.createReadStream(filePath),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  return {
    fileId: uploaded.data.id,
    link: uploaded.data.webViewLink || `https://drive.google.com/file/d/${uploaded.data.id}/view`,
    mimeType,
  };
}

async function uploadEmployeeFile({ employeeId, docType, filePath, fileName, notes, expiry }) {
  const name = fileName || path.basename(filePath);
  if (useSupabase()) {
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
  const auth = await getDriveAuth();
  const drive = getDriveClient(auth);
  const folderId = await getOrCreateFolder();

  const uploaded = await drive.files.create({
    requestBody: {
      name: `${employeeId} — ${name}`,
      parents: [folderId],
    },
    media: {
      mimeType: "application/octet-stream",
      body: fs.createReadStream(filePath),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  return {
    employeeId,
    docType: docType || "Other",
    fileName: name,
    driveFileId: uploaded.data.id,
    driveLink: uploaded.data.webViewLink || `https://drive.google.com/file/d/${uploaded.data.id}/view`,
    uploadedAt: new Date().toISOString(),
    expiry: expiry || "",
    notes: notes || "",
  };
}

module.exports = {
  DOC_TYPES,
  DEFAULT_DRIVE_FOLDER_ID,
  uploadEmployeeFile,
  uploadProfilePhoto,
  getDriveFileStream,
  deleteDriveFile,
  getOrCreateFolder,
  getOrCreateProfilePhotosFolder,
  guessImageMime,
};
