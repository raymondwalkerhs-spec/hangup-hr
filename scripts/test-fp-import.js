#!/usr/bin/env node
/** Unit tests for fingerprint attendance import parsing and shift grouping. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const fp = require("../lib/attendance-fp-import");

function test(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

console.log("attendance-fp-import");

test("parsePunchTime handles AM/PM datetime strings", () => {
  const t = fp.parsePunchTime("7/1/2026 1:36:58 PM");
  assert.equal(t.hours, 13);
  assert.equal(t.minutes, 36);
  const out = fp.parsePunchTime("7/1/2026 11:05:25 PM");
  assert.equal(out.hours, 23);
  assert.equal(out.minutes, 5);
});

test("localDateStrFromValue avoids UTC ISO shift", () => {
  const d = new Date(2026, 6, 1, 13, 36);
  assert.equal(fp.localDateStrFromValue(d), "2026-07-01");
  assert.equal(fp.localDateStrFromValue("7/1/2026 1:36:58 PM"), "2026-07-01");
});

test("detectColumns does not double-map Date/Time as date and datetime", () => {
  const cols = fp.detectColumns(["Name", "No.", "Date/Time"]);
  assert.equal(cols.datetimeIdx, 2);
  assert.equal(cols.dateIdx, -1);
});

test("July 2026 FP.xls Sarah 7/1 in ~13:36 out ~23:05", () => {
  const buf = fs.readFileSync(path.join(__dirname, "../Asset/July 2026 FP.xls"));
  const punches = fp.parseWorkbook(buf);
  const sarah = punches.filter((p) => p.fpNumber === "8" && p.date === "2026-07-01");
  assert(sarah.length >= 2, "expected Sarah punches on 2026-07-01");
  const grouped = fp.groupPunchesByDay(punches);
  const day = grouped.find((g) => g.fpNumber === "8" && g.date === "2026-07-01");
  assert(day, "Sarah 2026-07-01 group missing");
  assert.equal(day.checkIn, 13 * 60 + 36);
  assert.equal(day.checkOut, 23 * 60 + 5);
});

test("single check-in only still records day with null checkOut", () => {
  const grouped = fp.groupPunchesByDay([
    { fpNumber: "99", name: "Solo", date: "2026-07-03", timeMinutes: 13 * 60 + 30 },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].checkIn, 13 * 60 + 30);
  assert.equal(grouped[0].checkOut, null);
});

test("early AM logout attaches to previous work date", () => {
  const grouped = fp.groupPunchesByDay([
    { fpNumber: "8", name: "Sarah", date: "2026-07-01", timeMinutes: 13 * 60 + 36 },
    { fpNumber: "8", name: "Sarah", date: "2026-07-02", timeMinutes: 30 },
  ]);
  const day = grouped.find((g) => g.fpNumber === "8" && g.date === "2026-07-01");
  assert(day, "expected July 1 work day");
  assert.equal(day.checkIn, 13 * 60 + 36);
  assert.equal(day.checkOut, 30);
  assert(!grouped.some((g) => g.fpNumber === "8" && g.date === "2026-07-02" && g.checkOut === 30));
});

test("duplicate punch times deduped per employee per work day", () => {
  const grouped = fp.groupPunchesByDay([
    { fpNumber: "8", name: "Sarah", date: "2026-07-01", timeMinutes: 13 * 60 + 36 },
    { fpNumber: "8", name: "Sarah", date: "2026-07-01", timeMinutes: 13 * 60 + 36 },
    { fpNumber: "8", name: "Sarah", date: "2026-07-01", timeMinutes: 23 * 60 + 5 },
  ]);
  const day = grouped.find((g) => g.fpNumber === "8" && g.date === "2026-07-01");
  assert.equal(day.checkIn, 13 * 60 + 36);
  assert.equal(day.checkOut, 23 * 60 + 5);
});

test("ID+Date only still Attended via processImport", () => {
  const XLSX = require("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Name", "No.", "Date"],
    ["Test Agent", "77", "2026-07-15"],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xls" });
  const result = fp.processImport({
    buffer,
    employees: [{ id: "HS1-77", fp_number: "77" }],
    rules: fp.DEFAULT_FP_RULES,
    month: "2026-07",
  });
  assert.equal(result.rowsApplied, 1);
  assert.equal(result.records[0].status, "Attended");
  assert.equal(result.records[0].fpNotes, "FP date only");
});

test("no-logout fpNotes mentions missing logout", () => {
  assert.equal(
    fp.buildFpNotes(13 * 60 + 36, null),
    "FP in 13:36 (no logout punch)"
  );
});

console.log(process.exitCode ? "\nSome tests failed." : "\nAll tests passed.");
