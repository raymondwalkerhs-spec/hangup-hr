/**
 * One-time seed: push local JSON (from hr-system/data) to Google Sheet.
 * Requires GOOGLE_APPLICATION_CREDENTIALS or run after manual OAuth — 
 * this script uses OAuth device flow alternative: paste tokens from logged-in session.
 *
 * Simpler: use the app's Sync after placing data in cache manually, OR
 * run with service account (not included) — recommended path is:
 *   1. Share sheet with your Gmail
 *   2. npm start → login → Sync (pulls from existing Employee_Database tab)
 *   3. Use Attendance → Init weekends for July
 *
 * This script seeds Attendance_Events from ../hr-system/data/attendance.json
 * using a service-style approach: reads cache and writes via sheets API with
 * an access token passed as env ACCESS_TOKEN (optional advanced use).
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const sheets = require("./lib/sheets");

const DATA_DIR = path.join(__dirname, "..", "..", "hr-system", "data");

async function main() {
  const token = process.env.ACCESS_TOKEN;
  if (!token) {
    console.log(`
Seed script needs a Google access token with spreadsheets scope.

Easier approach:
  1. npm start
  2. Sign in with Google
  3. Open Attendance → pick month → "Init weekends"
  4. Mark weekdays as needed — data writes to Attendance_Events tab

To seed from JSON manually, set ACCESS_TOKEN in .env (from OAuth playground).
`);
    process.exit(0);
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });

  const attendancePath = path.join(DATA_DIR, "attendance.json");
  if (!fs.existsSync(attendancePath)) {
    console.error("No attendance.json at", attendancePath);
    process.exit(1);
  }

  const attendance = JSON.parse(fs.readFileSync(attendancePath, "utf8"));
  let count = 0;
  for (const [ym, records] of Object.entries(attendance)) {
    console.log(`Seeding ${ym}: ${records.length} records…`);
    for (const rec of records) {
      await sheets.upsertAttendanceRow(
        auth,
        {
          employeeId: rec.employeeId,
          date: rec.date,
          status: rec.status,
          fpLateness: rec.fpLateness,
          isWeekendDefault: rec.isWeekendDefault,
        },
        "seed-script"
      );
      count++;
    }
  }
  console.log(`Done. ${count} attendance rows written to sheet.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
