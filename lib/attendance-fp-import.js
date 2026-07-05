/**
 * Fingerprint device attendance import — parse punches, apply per-month rules.
 */
const XLSX = require("xlsx");

const STATUS_SEVERITY = {
  Attended: 0,
  "Lateness A": 1,
  "Lateness B": 2,
  "Quarter Day-Off": 3,
  "Half Day": 4,
};

const DEFAULT_FP_RULES = {
  checkIn: {
    onTimeBefore: "14:50",
    latenessAUntil: "15:00",
    latenessBUntil: "15:30",
    quarterDayUntil: "17:00",
    halfDayAfter: "17:00",
  },
  checkOut: {
    expected: "12:00",
    graceUntil: "13:00",
    halfDayFrom: "19:00",
    halfDayUntil: "22:00",
    quarterDayFrom: "22:00",
    quarterDayUntil: "23:55",
    note:
      "Agents may FP for logout at noon; grace until 1 PM. Leaving 7–10 PM = Half day; 10–11:55 PM = Quarter day unless HR overrides.",
  },
};

function parseTimeToMinutes(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map(Number);
  return h * 60 + (m || 0);
}

function parsePunchTime(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return { hours: value.getHours(), minutes: value.getMinutes(), raw: value.toISOString() };
  }
  const s = String(value).trim();
  const excelNum = Number(s);
  if (!Number.isNaN(excelNum) && excelNum > 0 && excelNum < 1) {
    const totalMin = Math.round(excelNum * 24 * 60);
    return { hours: Math.floor(totalMin / 60), minutes: totalMin % 60, raw: s };
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && s.includes("-")) {
    return { hours: d.getHours(), minutes: d.getMinutes(), raw: s };
  }
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return { hours: parseInt(m[1], 10), minutes: parseInt(m[2], 10), raw: s };
  return null;
}

function minutesOfDay(t) {
  if (!t) return null;
  return t.hours * 60 + t.minutes;
}

function statusFromCheckIn(minutes, rules) {
  const r = rules.checkIn || DEFAULT_FP_RULES.checkIn;
  if (minutes == null) return null;
  const onTime = parseTimeToMinutes(r.onTimeBefore);
  const latA = parseTimeToMinutes(r.latenessAUntil);
  const latB = parseTimeToMinutes(r.latenessBUntil);
  const quarter = parseTimeToMinutes(r.quarterDayUntil);
  const half = parseTimeToMinutes(r.halfDayAfter);
  if (minutes <= onTime) return "Attended";
  if (minutes <= latA) return "Lateness A";
  if (minutes <= latB) return "Lateness B";
  if (minutes <= quarter) return "Quarter Day-Off";
  if (minutes >= half) return "Half Day";
  return "Quarter Day-Off";
}

function statusFromCheckOut(minutes, rules) {
  const r = rules.checkOut || DEFAULT_FP_RULES.checkOut;
  if (minutes == null) return null;
  const grace = parseTimeToMinutes(r.graceUntil);
  const halfFrom = parseTimeToMinutes(r.halfDayFrom);
  const halfUntil = parseTimeToMinutes(r.halfDayUntil);
  const quarterFrom = parseTimeToMinutes(r.quarterDayUntil);
  const quarterUntil = parseTimeToMinutes(r.quarterDayUntil);
  if (minutes <= grace) return "Attended";
  if (minutes >= halfFrom && minutes < halfUntil) return "Half Day";
  if (minutes >= quarterFrom && minutes <= quarterUntil) return "Quarter Day-Off";
  return "Attended";
}

function worstStatus(a, b) {
  if (!a) return b;
  if (!b) return a;
  const sa = STATUS_SEVERITY[a] ?? 0;
  const sb = STATUS_SEVERITY[b] ?? 0;
  return sa >= sb ? a : b;
}

function normalizeFpNumber(v) {
  if (v == null || v === "") return "";
  return String(v).trim().replace(/^0+/, "") || "0";
}

function detectColumns(headers) {
  const lower = headers.map((h) => String(h || "").toLowerCase().trim());
  const find = (...names) => {
    for (const n of names) {
      const i = lower.findIndex((h) => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    fpIdx: find("fp", "enroll", "userid", "user id", "id", "no."),
    nameIdx: find("name", "employee"),
    dateIdx: find("date", "day"),
    timeIdx: find("time", "punch", "clock"),
    datetimeIdx: find("datetime", "date time", "date/time"),
  };
}

function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return [];
  const headers = rows[0].map(String);
  const cols = detectColumns(headers);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    let fp = cols.fpIdx >= 0 ? normalizeFpNumber(row[cols.fpIdx]) : "";
    let dateStr = "";
    let timeMin = null;
    if (cols.datetimeIdx >= 0 && row[cols.datetimeIdx]) {
      const dt = parsePunchTime(row[cols.datetimeIdx]);
      if (dt) {
        const raw = row[cols.datetimeIdx];
        if (raw instanceof Date) dateStr = raw.toISOString().slice(0, 10);
        else {
          const m = String(raw).match(/(\d{4}-\d{2}-\d{2})/);
          dateStr = m ? m[1] : "";
        }
        timeMin = minutesOfDay(dt);
      }
    }
    if (cols.dateIdx >= 0 && row[cols.dateIdx]) {
      const d = row[cols.dateIdx];
      if (d instanceof Date) dateStr = d.toISOString().slice(0, 10);
      else {
        const m = String(d).match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if (m) {
          if (m[1]) dateStr = m[1];
          else {
            const p = new Date(m[2]);
            if (!Number.isNaN(p.getTime())) dateStr = p.toISOString().slice(0, 10);
          }
        }
      }
    }
    if (cols.timeIdx >= 0 && row[cols.timeIdx]) {
      const t = parsePunchTime(row[cols.timeIdx]);
      timeMin = minutesOfDay(t);
    }
    if (!fp && cols.nameIdx < 0) continue;
    const name = cols.nameIdx >= 0 ? String(row[cols.nameIdx] || "").trim() : "";
    if (!dateStr) continue;
    out.push({ fpNumber: fp, name, date: dateStr, timeMinutes: timeMin, rawTime: timeMin });
  }
  return out;
}

function groupPunchesByDay(punches) {
  const map = new Map();
  for (const p of punches) {
    const key = `${p.fpNumber}|${p.date}`;
    if (!map.has(key)) {
      map.set(key, { fpNumber: p.fpNumber, name: p.name, date: p.date, times: [] });
    }
    const g = map.get(key);
    if (p.name && !g.name) g.name = p.name;
    if (p.timeMinutes != null) g.times.push(p.timeMinutes);
  }
  return [...map.values()].map((g) => ({
    ...g,
    checkIn: g.times.length ? Math.min(...g.times) : null,
    checkOut: g.times.length > 1 ? Math.max(...g.times) : g.times.length === 1 ? g.times[0] : null,
  }));
}

function buildFpEmployeeMap(employees) {
  const byFp = new Map();
  for (const e of employees) {
    const fp = normalizeFpNumber(e.fp_number);
    if (fp) byFp.set(fp, e.id);
  }
  return byFp;
}

function formatMinutes(min) {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** True when an existing day should not be replaced by FP import (skip_manual policy). */
function isProtectedAttendanceRecord(existing) {
  if (!existing) return false;
  // Auto weekend Day-OFF placeholders from init-month — only rows with no manual fields.
  if (existing.isWeekendDefault) return false;
  if (existing.status) return true;
  if (existing.paidLeave) return true;
  if (existing.transportOverride) return true;
  if (existing.leaveNote) return true;
  if (existing.fpNotes) return true;
  return false;
}

function processImport({ buffer, employees, rules, month, existingRecords = [], overwritePolicy = "skip_manual" }) {
  const punches = parseWorkbook(buffer);
  const grouped = groupPunchesByDay(punches);
  const fpMap = buildFpEmployeeMap(employees);
  const existingMap = new Map();
  for (const r of existingRecords) {
    existingMap.set(`${r.employeeId}|${r.date}`, r);
  }

  const preview = [];
  const toApply = [];
  const unmatchedFp = new Set();
  let skipped = 0;

  for (const g of grouped) {
    if (!g.date.startsWith(month)) continue;
    const employeeId = fpMap.get(normalizeFpNumber(g.fpNumber));
    if (!employeeId) {
      unmatchedFp.add(g.fpNumber || g.name || "?");
      preview.push({
        fpNumber: g.fpNumber,
        name: g.name,
        date: g.date,
        status: "unmatched",
        checkIn: formatMinutes(g.checkIn),
        checkOut: formatMinutes(g.checkOut),
      });
      continue;
    }

    const inStatus = statusFromCheckIn(g.checkIn, rules);
    const outStatus = statusFromCheckOut(g.checkOut, rules);
    let status = worstStatus(inStatus, outStatus);
    if (!status) status = "Attended";
    const fpLateness = inStatus === "Lateness A" || inStatus === "Lateness B";
    const fpNotes =
      g.checkIn != null || g.checkOut != null
        ? `FP in ${formatMinutes(g.checkIn)} out ${formatMinutes(g.checkOut)}`
        : "FP date only";

    const key = `${employeeId}|${g.date}`;
    const existing = existingMap.get(key);
    if (existing && overwritePolicy === "skip_manual" && isProtectedAttendanceRecord(existing)) {
      skipped++;
      preview.push({
        employeeId,
        fpNumber: g.fpNumber,
        date: g.date,
        status: "skipped",
        proposed: status,
        existing: existing.status || "(manual)",
        checkIn: formatMinutes(g.checkIn),
        checkOut: formatMinutes(g.checkOut),
      });
      continue;
    }

    preview.push({
      employeeId,
      fpNumber: g.fpNumber,
      date: g.date,
      status,
      checkIn: formatMinutes(g.checkIn),
      checkOut: formatMinutes(g.checkOut),
    });

    toApply.push({
      employeeId,
      date: g.date,
      status,
      fpLateness,
      fpNotes,
      leaveNote: existing?.leaveNote || fpNotes,
      isWeekendDefault: false,
      paidLeave: existing?.paidLeave || false,
      transportOverride: existing?.transportOverride || "",
    });
  }

  return {
    rowsParsed: grouped.length,
    rowsApplied: toApply.length,
    rowsSkipped: skipped,
    preview,
    records: toApply,
    unmatchedFp: [...unmatchedFp],
  };
}

function getRulesForMonth(config, month) {
  const byMonth = config?.attendanceFpRulesByMonth || {};
  return { ...DEFAULT_FP_RULES, ...(byMonth[month] || {}) };
}

module.exports = {
  DEFAULT_FP_RULES,
  parseWorkbook,
  groupPunchesByDay,
  processImport,
  isProtectedAttendanceRecord,
  getRulesForMonth,
  statusFromCheckIn,
  statusFromCheckOut,
  normalizeFpNumber,
};
