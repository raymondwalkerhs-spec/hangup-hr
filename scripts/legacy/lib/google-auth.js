const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");

function resolveCredentialsPath() {
  const candidates = [];

  if (process.env.GOOGLE_SERVICE_ACCOUNT_PATH) {
    const envPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
    candidates.push(
      path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath),
      path.join(__dirname, "..", envPath.replace(/^\.\//, ""))
    );
  }

  candidates.push(
    path.join(__dirname, "..", "credentials", "service-account.json"),
    path.join(process.resourcesPath || "", "credentials", "service-account.json")
  );

  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(
      path.join(process.env.PORTABLE_EXECUTABLE_DIR, "credentials", "service-account.json"),
      path.join(process.env.PORTABLE_EXECUTABLE_DIR, "HangupHR-data", "credentials", "service-account.json")
    );
  }

  const execDir = path.dirname(process.execPath || "");
  if (execDir) {
    candidates.push(path.join(execDir, "credentials", "service-account.json"));
  }

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return path.normalize(p);
  }

  return path.normalize(
    candidates.find((p) => p && p.includes("service-account")) ||
      path.join(__dirname, "..", "credentials", "service-account.json")
  );
}

let sheetsClientPromise = null;
let driveClientPromise = null;

function createAuth(scopes) {
  const keyFile = resolveCredentialsPath();
  if (!fs.existsSync(keyFile)) {
    throw new Error(
      `Missing service-account.json at ${keyFile}. Share both Google Sheets with the service account email as Editor.`
    );
  }
  const auth = new google.auth.GoogleAuth({ keyFile, scopes });
  return auth.getClient();
}

async function getSheetsAuth() {
  if (!sheetsClientPromise) {
    sheetsClientPromise = createAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  }
  return sheetsClientPromise;
}

async function getDriveAuth() {
  if (!driveClientPromise) {
    driveClientPromise = createAuth([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive",
    ]);
  }
  return driveClientPromise;
}

function getSheetsClient(auth) {
  return google.sheets({ version: "v4", auth });
}

function getDriveClient(auth) {
  return google.drive({ version: "v3", auth });
}

module.exports = {
  getSheetsAuth,
  getDriveAuth,
  getSheetsClient,
  getDriveClient,
  resolveCredentialsPath,
};
