const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const AUTH_TTL_MS = 60_000;
let cachedAuth = null;
let cachedAuthAt = 0;

function getEnv(key) {
  return String(process.env[key] || "").trim();
}

function log(...args) {
  console.log("[google-sheets]", ...args);
}

function resolveKeyPath(rawPath) {
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;
  const cwd = path.join(process.cwd(), rawPath);
  if (fs.existsSync(cwd)) return cwd;
  const alt = path.join(__dirname, "..", rawPath);
  if (fs.existsSync(alt)) return alt;
  const execDir = path.dirname(process.execPath || "");
  if (execDir) {
    const execPath = path.join(execDir, rawPath);
    if (fs.existsSync(execPath)) return execPath;
  }
  try {
    if (process.resourcesPath) {
      const resPath = path.join(process.resourcesPath, rawPath);
      if (fs.existsSync(resPath)) return resPath;
    }
  } catch {
    /* noop */
  }
  try {
    const { app } = require("electron");
    if (app?.getPath) {
      const userData = path.join(app.getPath("userData"), "HangupHR-data", rawPath);
      if (fs.existsSync(userData)) return userData;
      const userCreds = path.join(app.getPath("userData"), "credentials", path.basename(rawPath));
      if (fs.existsSync(userCreds)) return userCreds;
    }
  } catch {
    /* noop */
  }
  return rawPath;
}

function loadServiceAccount() {
  const keyPath = getEnv("INTERVIEWS_KEY");
  if (!keyPath) {
    const err = new Error("Missing INTERVIEWS_KEY env var");
    log("loadServiceAccount FAIL:", err.message, "cwd=", process.cwd(), "execPath=", process.execPath);
    throw err;
  }
  const resolved = resolveKeyPath(keyPath);
  log("loadServiceAccount path=", resolved, "exists=", fs.existsSync(resolved));
  if (!fs.existsSync(resolved)) {
    const err = new Error(`INTERVIEWS_KEY file not found: ${resolved}`);
    log("loadServiceAccount FAIL:", err.message);
    throw err;
  }
  const raw = fs.readFileSync(resolved, "utf8");
  return JSON.parse(raw);
}

async function getAuth() {
  const now = Date.now();
  if (cachedAuth && now - cachedAuthAt < AUTH_TTL_MS) {
    log("getAuth cache hit");
    return cachedAuth;
  }
  log("getAuth creating new client");
  const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
  const sa = loadServiceAccount();
  const auth = new google.auth.GoogleAuth({
    scopes,
    credentials: sa,
  });
  cachedAuth = await auth.getClient();
  cachedAuthAt = now;
  log("getAuth created client email=", sa.client_email || sa.email);
  return cachedAuth;
}

async function sheetsClient() {
  const auth = await getAuth();
  return google.sheets({ version: "v4", auth });
}

async function readSheet(spreadsheetId, range) {
  const s = await sheetsClient();
  const res = await s.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

async function appendRow(spreadsheetId, range, values) {
  const s = await sheetsClient();
  const res = await s.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  });
  return res.data;
}

async function updateCells(spreadsheetId, range, values) {
  const s = await sheetsClient();
  const res = await s.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  return res.data;
}

async function clearRange(spreadsheetId, range) {
  const s = await sheetsClient();
  const res = await s.spreadsheets.values.clear({ spreadsheetId, range });
  return res.data;
}

async function getSheetMeta(spreadsheetId) {
  const s = await sheetsClient();
  const res = await s.spreadsheets.get({ spreadsheetId, includeGridData: false });
  return res.data;
}

async function getTabMeta(spreadsheetId, tab) {
  const s = await sheetsClient();
  const res = await s.spreadsheets.get({ spreadsheetId, ranges: [`'${tab}'!A1:Z1`], includeGridData: false });
  return res.data;
}

function resolveSpreadsheetId() {
  return getEnv("INTERVIEW_SHEET");
}

function resolveTab() {
  return getEnv("INTERVIEW_TAB") || "Form Responses 1";
}

function isConfigured() {
  return Boolean(getEnv("INTERVIEW_SHEET") && getEnv("INTERVIEWS_KEY"));
}

module.exports = {
  isConfigured,
  getAuth,
  readSheet,
  appendRow,
  updateCells,
  clearRange,
  getSheetMeta,
  getTabMeta,
  resolveSpreadsheetId,
  resolveTab,
  loadServiceAccount,
};
