/**
 * Google Form → Supabase sync for Hangup HR candidate_applications.
 *
 * ARCHITECTURE:
 *   - New submissions: POST to Supabase, store returned UUID in sheet
 *   - Edits: PATCH by UUID, never creates duplicates
 *   - Each sheet row permanently owns its Supabase record via UUID
 *
 * DEPLOYMENT STEPS:
 *   1. Open your Google Sheet (linked to the Form).
 *   2. Extensions → Apps Script.
 *   3. Delete any existing code and paste this entire file.
 *   4. Update SUPABASE_URL and SUPABASE_SECRET_KEY below.
 *      IMPORTANT: Use the SUPABASE_SECRET_KEY (service_role), NOT the anon key.
 *      Find it in: Supabase Dashboard → Settings → API → "service_role" key
 *   5. Save → click run → installTriggers() once to authorize.
 *   6. New form submissions will auto-sync to Supabase.
 *   7. Run backfillExistingRows() once to sync historical data.
 *
 * SHEET LAYOUT:
 *   Columns A-V   : Form fields (synced by Apps Script)
 *   Columns W-AG  : HR fields (synced by app backend)
 *   Columns AH    : Sync Status
 *   Columns AI    : Sync Time
 *   Columns AJ    : Supabase ID (hidden, managed by script)
 */

// ============================================================
// CONFIG — UPDATE THESE TWO VALUES
// ============================================================
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_SECRET_KEY = "YOUR_SERVICE_ROLE_KEY_HERE";
const SUPABASE_TABLE = "candidate_applications";

// Validate config on load — fail fast if placeholders are still present
(function validateConfig() {
  if (SUPABASE_URL.includes("YOUR-PROJECT") || SUPABASE_SECRET_KEY.includes("YOUR_SERVICE_ROLE_KEY")) {
    throw new Error(
      "[form-sync] CONFIG NOT SET: Update SUPABASE_URL and SUPABASE_SECRET_KEY in the Apps Script before deploying. " +
      "SUPABASE_URL example: https://xyzcompany.supabase.co"
    );
  }
})();

// ============================================================
// COLUMN MAP — 1-indexed positions in the Sheet.
// Adjust these numbers if your sheet column order changes.
// ============================================================
const COL = {
  timestamp: 1,
  name: 2,
  email: 3,
  phone: 4,
  whatsapp: 5,
  dateOfBirth: 6,
  address: 7,
  graduationStatus: 8,
  facultyName: 9,
  universityName: 10,
  nationalId: 11,
  previousExperiences: 12,
  gender: 13,
  englishSpeaking: 14,
  englishWriting: 15,
  englishListening: 16,
  fastPacedRating: 17,
  availableDays: 18,
  currentlyEmployed: 19,
  preferredWorkingMode: 20,
  howHeard: 21,
  companyIfYes: 22,
};

// Script-managed columns — never sync these as form data
// Updated for v1.9.8 layout: 22 form columns + 11 HR columns = 33 total before sync columns
const SYNC_STATUS_COL = 34;   // AH
const SYNC_TIME_COL = 35;     // AI
const SUPABASE_ID_COL = 36;   // AJ

// ============================================================
// TRIGGER INSTALLATION
// ============================================================

function installTriggers() {
  uninstallTriggers();
  ScriptApp.newTrigger("onFormSubmit")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onFormSubmit()
    .create();
  ScriptApp.newTrigger("onEdit")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();
  console.log("[form-sync] triggers installed: onFormSubmit + onEdit");
}

function uninstallTriggers() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  console.log("[form-sync] all triggers removed");
}

// ============================================================
// ENTRY POINTS
// ============================================================

function onFormSubmit(e) {
  if (!e || !e.values || !e.range) {
    console.warn("[form-sync] missing event data");
    return;
  }
  const row = e.values;
  const rowNumber = e.range.getRow();
  const sheet = e.range.getSheet();

  try {
    const result = syncRowToSupabase(sheet, rowNumber, row);
    logSyncStatus(sheet, rowNumber, result);
  } catch (err) {
    console.error("[form-sync] onFormSubmit fatal:", err.message);
    logSyncStatus(sheet, rowNumber, { ok: false, error: err.message });
  }
}

function onEdit(e) {
  if (!e || !e.range || !e.value) return;
  
  // Ignore edits to script-managed columns to prevent infinite loops
  const editedCol = e.range.getColumn();
  if ([SYNC_STATUS_COL, SYNC_TIME_COL, SUPABASE_ID_COL].includes(editedCol)) {
    return;
  }

  const sheet = e.range.getSheet();
  const rowNumber = e.range.getRow();
  if (rowNumber < 2) return; // skip header

  try {
    const row = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
    const result = syncRowToSupabase(sheet, rowNumber, row);
    logSyncStatus(sheet, rowNumber, result);
  } catch (err) {
    console.error("[form-sync] onEdit fatal:", err.message);
    logSyncStatus(sheet, rowNumber, { ok: false, error: err.message });
  }
}

// ============================================================
// CORE SYNC LOGIC — UUID-based insert/patch
// ============================================================

function syncRowToSupabase(sheet, rowNumber, row) {
  const supabaseId = readSupabaseId(sheet, rowNumber);
  const payload = buildPayload(row);

  if (supabaseId) {
    return patchCandidateInSupabase(supabaseId, payload);
  } else {
    return postCandidateToSupabase(sheet, rowNumber, payload);
  }
}

function postCandidateToSupabase(sheet, rowNumber, payload) {
  const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`;
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SECRET_KEY,
      "Authorization": `Bearer ${SUPABASE_SECRET_KEY}`,
      "Prefer": "return=representation",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  const body = JSON.parse(response.getContentText());

  if (statusCode >= 200 && statusCode < 300) {
    const inserted = Array.isArray(body) ? body[0] : body;
    const newId = inserted?.id || "";
    if (newId) {
      writeSupabaseId(sheet, rowNumber, newId);
    }
    console.log(`[form-sync] inserted row ${rowNumber}: ${payload.name} → ${newId}`);
    return { ok: true, data: body, action: "insert" };
  }

  const errorMsg = extractErrorMessage(body);
  console.error(`[form-sync] POST failed row ${rowNumber}: HTTP ${statusCode}: ${errorMsg}`);
  return { ok: false, error: errorMsg, status: statusCode, action: "insert" };
}

function patchCandidateInSupabase(supabaseId, payload) {
  const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(supabaseId)}`;
  const options = {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_SECRET_KEY,
      "Authorization": `Bearer ${SUPABASE_SECRET_KEY}`,
      "Prefer": "return=representation",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  const body = JSON.parse(response.getContentText());

  if (statusCode >= 200 && statusCode < 300) {
    console.log(`[form-sync] patched ${supabaseId}`);
    return { ok: true, data: body, action: "update" };
  }

  const errorMsg = extractErrorMessage(body);
  console.error(`[form-sync] PATCH failed ${supabaseId}: HTTP ${statusCode}: ${errorMsg}`);
  return { ok: false, error: errorMsg, status: statusCode, action: "update" };
}

// ============================================================
// PAYLOAD BUILDING
// ============================================================

function buildPayload(row) {
  const get = (colIndex) => {
    if (!colIndex || row.length < colIndex) return "";
    const val = row[colIndex - 1];
    return val !== undefined && val !== null ? String(val).trim() : "";
  };

  const payload = {
    timestamp: get(COL.timestamp),
    name: get(COL.name),
    email: get(COL.email),
    phone: get(COL.phone),
    whatsapp: get(COL.whatsapp),
    date_of_birth: get(COL.dateOfBirth),
    address: get(COL.address),
    graduation_status: get(COL.graduationStatus),
    faculty_name: get(COL.facultyName),
    university_name: get(COL.universityName),
    national_id: get(COL.nationalId),
    previous_experiences: get(COL.previousExperiences),
    gender: get(COL.gender),
    english_speaking: get(COL.englishSpeaking),
    english_writing: get(COL.englishWriting),
    english_listening: get(COL.englishListening),
    fast_paced_rating: get(COL.fastPacedRating),
    available_days: get(COL.availableDays),
    currently_employed: get(COL.currentlyEmployed),
    preferred_working_mode: get(COL.preferredWorkingMode),
    how_heard: get(COL.howHeard),
    company_if_yes: get(COL.companyIfYes),
  };

  return cleanPayload(payload);
}

function cleanPayload(payload) {
  const cleaned = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== "" && value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

// ============================================================
// SUPABASE ID HELPERS
// ============================================================

function readSupabaseId(sheet, rowNumber) {
  if (!sheet || !rowNumber) return "";
  const val = sheet.getRange(rowNumber, SUPABASE_ID_COL).getValue();
  return String(val || "").trim();
}

function writeSupabaseId(sheet, rowNumber, id) {
  if (!sheet || !rowNumber || !id) return;
  sheet.getRange(rowNumber, SUPABASE_ID_COL).setValue(id);
}

// ============================================================
// AUDIT LOG
// ============================================================

function logSyncStatus(sheet, rowNumber, result) {
  if (!sheet || !rowNumber) return;

  const statusHeader = sheet.getRange(1, SYNC_STATUS_COL).getValue();
  const timeHeader = sheet.getRange(1, SYNC_TIME_COL).getValue();
  
  if (!statusHeader) {
    sheet.getRange(1, SYNC_STATUS_COL).setValue("Sync Status");
    sheet.getRange(1, SYNC_TIME_COL).setValue("Sync Time");
    sheet.getRange(1, SUPABASE_ID_COL).setValue("Supabase ID");
    sheet.getRange(1, SYNC_STATUS_COL, 1, 3).setFontWeight("bold");
  }

  const actionLabel = result.action === "insert" ? "INSERTED" : result.action === "update" ? "UPDATED" : "";
  const status = result.ok
    ? `SYNCED${actionLabel ? " (" + actionLabel + ")" : ""}`
    : `SYNC_FAILED: ${result.error || "unknown"}`;
  const time = new Date().toISOString();

  sheet.getRange(rowNumber, SYNC_STATUS_COL, 1, 3).setValues([[
    status,
    time,
    readSupabaseId(sheet, rowNumber),
  ]]);

  const color = result.ok ? "#d4edda" : "#f8d7da";
  sheet.getRange(rowNumber, SYNC_STATUS_COL, 1, 3).setBackground(color);
}

// ============================================================
// ERROR HELPERS
// ============================================================

function extractErrorMessage(body) {
  if (!body) return "Unknown error";
  if (typeof body === "string") return body;
  if (body.message) return body.message;
  if (body.error) return typeof body.error === "string" ? body.error : JSON.stringify(body.error);
  if (body.msg) return body.msg;
  return JSON.stringify(body).slice(0, 200);
}

// ============================================================
// MANUAL / BATCH OPERATIONS
// ============================================================

function syncRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const rowNumber = sheet.getActiveRange().getRow();
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0];

  const result = syncRowToSupabase(sheet, rowNumber, values);
  logSyncStatus(sheet, rowNumber, result);

  if (result.ok) {
    SpreadsheetApp.getUi().alert(`Row ${rowNumber}: ${result.action === "insert" ? "Inserted" : "Updated"} successfully`);
  } else {
    SpreadsheetApp.getUi().alert(`Row ${rowNumber}: Failed — ${result.error}`);
  }
}

function backfillExistingRows() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert("No data rows to backfill");
    return;
  }

  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    `Backfill ${lastRow - 1} rows to Supabase?`,
    "This will insert any rows without a Supabase ID, and update rows that already have one. Continue?",
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rowNumber = i + 2;
    const result = syncRowToSupabase(sheet, rowNumber, row);
    logSyncStatus(sheet, rowNumber, result);
    if (result.ok) {
      result.action === "insert" ? inserted++ : updated++;
    } else {
      failed++;
    }
  }

  ui.alert(`Backfill complete: ${inserted} inserted, ${updated} updated, ${failed} failed`);
}

function testConnection() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=id&limit=1`;
    const options = {
      method: "GET",
      headers: {
        "apikey": SUPABASE_SECRET_KEY,
        "Authorization": `Bearer ${SUPABASE_SECRET_KEY}`,
      },
      muteHttpExceptions: true,
    };
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      SpreadsheetApp.getUi().alert(`Connection OK (HTTP ${code})`);
    } else {
      SpreadsheetApp.getUi().alert(`Connection failed: HTTP ${code}\n${response.getContentText()}`);
    }
  } catch (err) {
    SpreadsheetApp.getUi().alert(`Connection error: ${err.message}`);
  }
}

function hideSyncColumns() {
  const sheet = SpreadsheetApp.getActiveSheet();
  sheet.hideColumns(SYNC_STATUS_COL);
  sheet.hideColumns(SYNC_TIME_COL);
  sheet.hideColumns(SUPABASE_ID_COL);
  SpreadsheetApp.getUi().alert("Sync columns AH, AI, AJ are now hidden");
}
