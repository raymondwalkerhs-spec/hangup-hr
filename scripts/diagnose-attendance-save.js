#!/usr/bin/env node
/**
 * Diagnose manual attendance save for one employee/day.
 * Usage: node scripts/diagnose-attendance-save.js HS1-05 2026-07-16
 */
require("dotenv").config();

const empId = process.argv[2];
const date = process.argv[3];
if (!empId || !date) {
  console.error("Usage: node scripts/diagnose-attendance-save.js <employeeId> <YYYY-MM-DD>");
  process.exit(1);
}

const month = date.slice(0, 7);
const repo = require("../lib/supabase-repo");
const store = require("../lib/data-store");
const cache = require("../lib/cache");

async function main() {
  console.log(`\nAttendance save diagnostic: ${empId} @ ${date}\n`);

  const before = await repo.readAttendanceEvents(month);
  const rowBefore = before.find((r) => r.employeeId === empId && r.date === date);
  console.log("Supabase BEFORE:", rowBefore ? JSON.stringify(rowBefore) : "(no row)");

  const saved = await store.saveAttendanceRow(
    { employeeId: empId, date, status: "Attended" },
    "diagnostic-script"
  );
  console.log("saveAttendanceRow returned:", JSON.stringify(saved));

  const afterRemote = await repo.readAttendanceEvents(month);
  const rowAfter = afterRemote.find((r) => r.employeeId === empId && r.date === date);
  console.log("Supabase AFTER:", rowAfter ? JSON.stringify(rowAfter) : "(no row)");

  const monthRead = await store.readAttendanceEventsForMonth(month);
  const rowRead = monthRead.find((r) => r.employeeId === empId && r.date === date);
  console.log("readAttendanceEventsForMonth:", rowRead ? JSON.stringify(rowRead) : "(no row)");

  const localOnly = cache.getAttendanceForMonth(month)?.find(
    (r) => r.employeeId === empId && r.date === date
  );
  console.log("Local SQLite cache:", localOnly ? JSON.stringify(localOnly) : "(no row)");

  const ok =
    String(saved?.status || "") === "Attended" &&
    String(rowAfter?.status || "") === "Attended" &&
    String(rowRead?.status || "") === "Attended";

  console.log(ok ? "\nPASS — manual Attended persisted end-to-end\n" : "\nFAIL — status did not persist\n");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
