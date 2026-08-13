#!/usr/bin/env node
/**
 * Sync candidate_applications from Supabase to Google Sheets.
 *
 * This is a manual/on-demand sync. The app no longer auto-syncs to Sheets.
 * Run this script whenever you want to refresh the Sheet from Supabase.
 *
 * Usage: node scripts/sync-interviews-to-sheets.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const googleSheets = require("../lib/google-sheets");

async function main() {
  console.log("[sync] starting interview sync from Supabase to Sheets...");

  if (!googleSheets.isConfigured()) {
    console.log("[sync] skipped: Google Sheets not configured");
    return;
  }

  const db = getSupabaseAdmin();
  const spreadsheetId = googleSheets.resolveSpreadsheetId();
  const tab = googleSheets.resolveTab();
  const auth = await googleSheets.getAuth();
  const { google } = require("googleapis");
  const sheets = google.sheets({ version: "v4", auth });

  const supabaseRepo = require("../lib/supabase-repo");
  const candidates = await supabaseRepo.readCandidateApplications({ role: "hr" });

  console.log(`[sync] fetched ${candidates?.length || 0} candidates from Supabase`);

  // Define headers
  const FORM_COLUMNS = ["Timestamp", "Name", "Email", "Phone", "Whatsapp", "Date of Birth", "Address", "Graduation status", "Faculty Name", "University Name", "National ID or Passport ID", "Previous Experiences", "Gender", "English Speaking", "English Writing", "English Listening", "Fast-paced rating", "Available days", "Currently employed", "Preferred working mode", "How heard", "Company if yes"];
  const HR_COLUMNS = ["1st Int Status", "1st Int Feedback", "1st Interview Date", "1st Interviewer", "2nd Int Status", "2nd Int Feedback", "2nd Interview Date", "2nd Interviewer", "Training Status", "Training Start Date", "Trainer"];
  const SYNC_COLUMNS = ["Sync Status", "Sync Time", "Supabase ID"];
  const headers = [...FORM_COLUMNS, ...HR_COLUMNS, ...SYNC_COLUMNS];
  const dataColumnCount = FORM_COLUMNS.length + HR_COLUMNS.length;
  const lastColumnLetter = columnLetter(headers.length - 1);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!A1:${lastColumnLetter}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });

  const values = (candidates || []).map((c) => {
    const row = [
      c.timestamp, c.name, c.email, c.phone, c.whatsapp, c.dateOfBirth, c.address,
      c.graduationStatus, c.facultyName, c.universityName, c.nationalId,
      c.previousExperiences, c.gender, c.englishSpeaking, c.englishWriting, c.englishListening,
      c.fastPacedRating, c.availableDays, c.currentlyEmployed, c.preferredWorkingMode,
      c.howHeard, c.companyIfYes,
      c.firstInterviewStatus, c.firstInterviewFeedback, c.interviewDate, c.interviewer,
      c.secondInterviewStatus, c.secondInterviewFeedback, c.secondInterviewDate, c.secondInterviewer,
      c.trainingStatus, c.trainingStartDate, c.trainer,
    ];
    while (row.length < dataColumnCount) row.push("");
    row.push("SYNCED", new Date().toISOString(), c.id || "");
    return row;
  });

  const clearRange = `'${tab}'!A2:${lastColumnLetter}1000`;
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: clearRange });
  if (values.length) {
    const endRow = values.length + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tab}'!A2:${lastColumnLetter}${endRow}`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }

  console.log(`[sync] completed: ${values.length} candidates synced to Sheets`);
}

function columnLetter(index) {
  let letter = "";
  while (index >= 0) {
    letter = String.fromCharCode(65 + (index % 26)) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

main().catch((e) => {
  console.error("[sync] fatal:", e.message);
  process.exit(1);
});
