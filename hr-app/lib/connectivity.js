const fs = require("fs");
const https = require("https");
const { getSheetsAuth, getSheetsClient, resolveCredentialsPath } = require("./google-auth");

const SHEET_ID =
  process.env.SHEET_ID || "17z8JrLV0_4fSXzsiZRpCZWFJk5FTit3IUkw0c3NOkvU";
const AUTH_SHEET_ID =
  process.env.AUTH_SHEET_ID || "1i4KR3e_jNtPMTSDFnbpS7kYzExqEyA0CgLlaZg5KoF8";

function probeUrl(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function isOnline() {
  const probes = [
    "https://www.google.com/generate_204",
    "https://www.gstatic.com/generate_204",
    "https://sheets.googleapis.com",
  ];
  for (const url of probes) {
    if (await probeUrl(url)) return true;
  }
  return false;
}

async function verifyGoogleSheetsAccess() {
  const keyFile = resolveCredentialsPath();
  if (!fs.existsSync(keyFile)) {
    throw new Error(
      `Service account key not found. Expected at: ${keyFile}. Reinstall the app or place service-account.json in credentials/.`
    );
  }

  const auth = await getSheetsAuth();
  const sheets = getSheetsClient(auth);

  await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: "spreadsheetId,properties.title",
  });
  await sheets.spreadsheets.get({
    spreadsheetId: AUTH_SHEET_ID,
    fields: "spreadsheetId,properties.title",
  });

  return { ok: true, credentialsPath: keyFile, sheetId: SHEET_ID, authSheetId: AUTH_SHEET_ID };
}

async function requireOnline() {
  if (await isOnline()) return true;

  try {
    await verifyGoogleSheetsAccess();
    return true;
  } catch (err) {
    const detail = err.message || String(err);
    if (detail.includes("not found") || detail.includes("ENOENT")) {
      throw err;
    }
    if (detail.includes("403") || detail.includes("permission")) {
      throw new Error(
        "Google Sheets access denied. Share both HR Data and HR Access sheets with the service account email (Editor)."
      );
    }
    throw new Error(
      `Cannot reach Google Sheets (${detail}). Check your internet connection and sheet sharing.`
    );
  }
}

module.exports = {
  isOnline,
  requireOnline,
  verifyGoogleSheetsAccess,
  probeUrl,
};
