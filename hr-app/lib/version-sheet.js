const { getSheetsAuth, getSheetsClient } = require("./google-auth");
const { AUTH_SHEET_ID } = require("./auth-sheet");
const { useSupabase } = require("./backend");
const { getSupabaseAdmin } = require("./supabase-client");

const VERSION_SHEET_TAB = process.env.VERSION_SHEET_TAB || "App_Versions";

function versionSheetRange() {
  return `'${VERSION_SHEET_TAB}'!A:F`;
}

function truthy(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return ["true", "yes", "y", "1", "current", "latest"].includes(s);
}

function findColumn(headers, names) {
  return headers.findIndex((h) => names.includes(String(h).trim().toLowerCase()));
}

function normalizePolicyRow(row, headers) {
  const versionCol = findColumn(headers, ["version", "app version", "app_version"]);
  const dateCol = findColumn(headers, ["release date", "date", "released"]);
  const typeCol = findColumn(headers, ["type", "release type", "change type"]);
  const minCol = findColumn(headers, [
    "min compatible",
    "min compatible version",
    "minimum compatible",
    "min_version",
  ]);
  const currentCol = findColumn(headers, ["current", "is current", "latest", "active"]);
  const notesCol = findColumn(headers, ["notes", "message", "description"]);

  if (versionCol < 0) return null;

  const version = String(row[versionCol] || "").trim();
  if (!version) return null;

  return {
    version,
    releaseDate: dateCol >= 0 ? String(row[dateCol] || "").trim() : "",
    releaseType: typeCol >= 0 ? String(row[typeCol] || "").trim().toLowerCase() : "",
    minCompatibleVersion:
      minCol >= 0 ? String(row[minCol] || "").trim() : "",
    isCurrent: currentCol >= 0 ? truthy(row[currentCol]) : false,
    notes: notesCol >= 0 ? String(row[notesCol] || "").trim() : "",
  };
}

async function fetchVersionPolicyFromSupabase() {
  const { data, error } = await getSupabaseAdmin()
    .from("app_versions")
    .select("*")
    .order("release_date", { ascending: true });
  if (error) throw error;
  if (!data?.length) return null;

  const entries = data.map((r) => ({
    version: r.version,
    releaseDate: r.release_date || "",
    releaseType: r.release_type || "minor",
    minCompatibleVersion: r.min_compatible_version || "",
    isCurrent: r.is_current === true,
    notes: r.notes || "",
  }));

  const current = entries.find((e) => e.isCurrent) || entries[entries.length - 1];
  const releaseType = current.releaseType || "minor";
  const minCompatibleVersion =
    current.minCompatibleVersion ||
    (releaseType === "major" ? current.version : entries[0]?.version || current.version);

  return {
    currentVersion: current.version,
    minCompatibleVersion,
    releaseType,
    releaseDate: current.releaseDate,
    updateMessage: current.notes
      ? `A newer version (${current.version}) is available: ${current.notes}`
      : "",
    blockedMessage: current.notes
      ? `This app version is no longer supported. ${current.notes} Contact Admin for version ${current.version}.`
      : "",
    entries,
  };
}

async function fetchVersionPolicy() {
  if (useSupabase()) {
    try {
      return await fetchVersionPolicyFromSupabase();
    } catch (err) {
      console.warn("Supabase version policy:", err.message);
      return null;
    }
  }

  const auth = await getSheetsAuth();
  const sheets = getSheetsClient(auth);

  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: AUTH_SHEET_ID,
      range: versionSheetRange(),
    });
  } catch (err) {
    if (String(err.message || "").includes("Unable to parse range")) {
      return null;
    }
    throw err;
  }

  const rows = res.data.values || [];
  if (rows.length < 2) return null;

  const headers = rows[0].map((h) => String(h).trim());
  const entries = rows
    .slice(1)
    .map((row) => normalizePolicyRow(row, headers))
    .filter(Boolean);

  if (!entries.length) return null;

  const current =
    entries.find((entry) => entry.isCurrent) ||
    entries[entries.length - 1];

  const releaseType = current.releaseType || "minor";
  const minCompatibleVersion =
    current.minCompatibleVersion ||
    (releaseType === "major" ? current.version : entries[0]?.version || current.version);

  return {
    currentVersion: current.version,
    minCompatibleVersion,
    releaseType,
    releaseDate: current.releaseDate,
    updateMessage: current.notes
      ? `A newer version (${current.version}) is available: ${current.notes}`
      : "",
    blockedMessage: current.notes
      ? `This app version is no longer supported. ${current.notes} Contact Admin for version ${current.version}.`
      : "",
    entries,
  };
}

module.exports = {
  VERSION_SHEET_TAB,
  fetchVersionPolicy,
};
