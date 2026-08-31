/**
 * Import historical RPM checks / Q Feedback from Excel.
 *
 * Sources:
 *  - Asset/RPM Q Feedback.xlsx (All sheet) — row-level feedback; Info used to match sales
 *  - Asset/Copy of HS3 Dashboard August.xlsx (Daily) — agent-day check counts when needed
 *  - Existing rpm_sales — any sale without a linked check gets a Q+sale check
 *
 * Usage:
 *   node scripts/import-rpm-q-feedback-xlsx.js            # dry-run
 *   node scripts/import-rpm-q-feedback-xlsx.js --apply
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const apply = process.argv.includes("--apply");
const qfbArg = process.argv.find((a) => a.startsWith("--qfb="));
const hs3Arg = process.argv.find((a) => a.startsWith("--hs3="));

const qfbPath = path.resolve(
  process.cwd(),
  qfbArg ? qfbArg.slice("--qfb=".length) : "Asset/RPM Q Feedback.xlsx"
);
const hs3Path = path.resolve(
  process.cwd(),
  hs3Arg ? hs3Arg.slice("--hs3=".length) : "Asset/Copy of HS3 Dashboard August.xlsx"
);

function excelSerialToIso(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return d.toISOString().slice(0, 10);
}

function excelSerialToDateTime(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const ms = (n - Math.floor(n)) * 86400000;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000 + ms);
  return d;
}

/** Parse sheet Timestamp → YYYY-MM-DD (handles Excel serials and M/D/YYYY strings). */
function parseSheetDay(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) return excelSerialToIso(ts);
  const s = String(ts || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseSheetDateTime(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) return excelSerialToDateTime(ts);
  const s = String(ts || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  const day = parseSheetDay(ts);
  return day ? new Date(`${day}T12:00:00.000Z`) : null;
}

function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function extractMemberId(info) {
  const { stripMemberId, validateMemberId } = require("../lib/rpm-member-id");
  const text = String(info || "").toUpperCase();
  const candidates = text.match(/[0-9A-Z]{11}/g) || [];
  for (const c of candidates) {
    const v = validateMemberId(c, { required: false });
    if (v.ok && v.value) return v.value;
  }
  // Looser: any 11-char alnum after strip
  for (const c of candidates) {
    const s = stripMemberId(c);
    if (s.length === 11) return s;
  }
  return "";
}

function extractNameFromInfo(info) {
  const text = String(info || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  // Name often sits next to an 11-char member id
  const nearId = text.match(
    /([A-Za-z][A-Za-z'’.\-]+(?:\s+[A-Za-z][A-Za-z'’.\-]+){1,3})\s+[0-9A-Za-z]{11}/
  );
  if (nearId) return nearId[1].trim();
  const nearIdAfter = text.match(
    /[0-9A-Za-z]{11}\s+([A-Za-z][A-Za-z'’.\-]+(?:\s+[A-Za-z][A-Za-z'’.\-]+){1,3})/
  );
  if (nearIdAfter) return nearIdAfter[1].trim();
  return "";
}

function mapFeedbackRaw(raw) {
  const {
    normalizeFeedbackStatus,
    normalizeCheckStatus,
  } = require("../lib/rpm-check-status");
  const s = String(raw || "").trim();
  const check = normalizeCheckStatus(s);
  if (check) return { checkStatus: check, feedbackStatus: null };
  const fb = normalizeFeedbackStatus(s);
  if (fb) return { checkStatus: "q", feedbackStatus: fb };
  if (/^sale$/i.test(s)) return { checkStatus: "q", feedbackStatus: "sale" };
  if (/^other$/i.test(s)) return { checkStatus: "q", feedbackStatus: null };
  return { checkStatus: "q", feedbackStatus: null };
}

function hashKey(parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
}

function nameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findEmployeeByName(employees, name) {
  const key = nameKey(name);
  if (!key) return null;
  return (
    employees.find((e) => nameKey(e.american_name) === key) ||
    employees.find((e) => nameKey(e.american_name).includes(key) || key.includes(nameKey(e.american_name))) ||
    null
  );
}

function findTeamAgent(employees, teamsMeta, teamName) {
  const { teamsMatch, employeeTeamKey } = require("../lib/team-names");
  const onTeam = employees.filter((e) => teamsMatch(employeeTeamKey(e, teamsMeta), teamName));
  if (!onTeam.length) return null;
  const meta = (teamsMeta || []).find((t) => teamsMatch(t.name, teamName));
  if (meta?.tlEmployeeId) {
    const tl = onTeam.find((e) => e.id === meta.tlEmployeeId);
    // Prefer a non-TL dialing agent when available
  }
  const { isDialingAgent } = require("../lib/dialing-agents");
  const dialing = onTeam.filter((e) => isDialingAgent(e, { activeOnly: false }));
  return dialing[0] || onTeam[0] || null;
}

function readQFeedbackRows(XLSX) {
  if (!fs.existsSync(qfbPath)) return [];
  const wb = XLSX.readFile(qfbPath);
  const sheetName =
    wb.SheetNames.find((n) => n === "All") ||
    wb.SheetNames.find((n) => /feedback/i.test(n)) ||
    wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  return rows.map((row, idx) => {
    const ts = row.Timestamp || row.timestamp || row.Date || row.date;
    const workingDay = parseSheetDay(ts);
    const dt = parseSheetDateTime(ts);
    const info = String(row.Info || row.info || "");
    const mapped = mapFeedbackRaw(row.Feedback || row.feedback || "");
    return {
      source: "qfb",
      rowIndex: idx + 2,
      workingDay,
      submissionDate: workingDay,
      submissionTime: dt ? dt.toISOString().slice(11, 19) : null,
      createdAt: dt ? dt.toISOString() : workingDay ? `${workingDay}T12:00:00.000Z` : null,
      phone: String(row["Phone No"] || row.Phone || row.phone || ""),
      team: String(row.Team || row.team || "").trim(),
      closerName: String(row.Closer || row.closer || "").trim(),
      info,
      memberId: extractMemberId(info),
      fullName: extractNameFromInfo(info),
      ...mapped,
      importKey: `qfb:${hashKey([
        workingDay,
        row["Phone No"] || row.Phone,
        row.Team,
        row.Closer,
        row.Feedback,
        info.slice(0, 80),
      ])}`,
    };
  });
}

function readHs3DailyRows(XLSX) {
  if (!fs.existsSync(hs3Path)) return [];
  const wb = XLSX.readFile(hs3Path);
  const sheet = wb.Sheets.Daily;
  if (!sheet) return [];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const out = [];
  let currentDay = null;
  for (let i = 0; i < grid.length; i++) {
    const r = grid[i];
    if (typeof r[0] === "number" && r[0] > 40000) {
      currentDay = excelSerialToIso(r[0]);
      continue;
    }
    if (String(r[0]).toLowerCase() === "team" || String(r[1]).toLowerCase() === "agent name") continue;
    if (!currentDay) continue;
    const agentName = String(r[1] || "").trim();
    if (!agentName || /^total$/i.test(agentName)) continue;
    const sent = Number(r[2]) || 0;
    const dup = Number(r[3]) || 0;
    const age = Number(r[4]) || 0;
    const q = Number(r[5]) || 0;
    const nq = Number(r[6]) || 0;
    if (!sent && !dup && !age && !q && !nq) continue;
    out.push({
      source: "hs3-daily",
      workingDay: currentDay,
      agentName,
      team: String(r[0] || "").trim(),
      sent,
      duplicate: dup,
      age_limit: age,
      q,
      nq,
      importKey: `hs3:${hashKey([currentDay, agentName, dup, age, q, nq])}`,
    });
  }
  return out;
}

async function main() {
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch {
    console.error("Install xlsx to run this importer");
    process.exit(1);
  }

  const qfbRows = readQFeedbackRows(XLSX);
  const hs3Rows = readHs3DailyRows(XLSX);
  console.log(`Q Feedback rows: ${qfbRows.length}`);
  console.log(`HS3 Daily agent-day rows: ${hs3Rows.length}`);
  console.log("Sample QFB:", JSON.stringify(qfbRows.slice(0, 3), null, 2));

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply to write rpm_checks.");
    return;
  }

  const { isSupabaseConfigured } = require("../lib/supabase-client");
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured");

  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const db = getSupabaseAdmin();
  const { data: empRows, error: empErr } = await db.from("employees").select("*");
  if (empErr) throw new Error(empErr.message);
  const employees = (empRows || []).map((r) => ({
    id: r.id,
    american_name: r.american_name,
    team: r.team,
    unit: r.unit,
    status: r.status,
    position: r.position,
    role: r.role,
  }));
  console.log(`Employees loaded: ${employees.length}`);
  let teamsMeta = [];
  try {
    teamsMeta = await require("../lib/hrms-repo").readOrgTeams();
  } catch {
    teamsMeta = [];
  }

  const rpmRepo = require("../lib/rpm-sales-repo");
  const rpmChecksRepo = require("../lib/rpm-checks-repo");
  const { stripMemberId } = require("../lib/rpm-member-id");

  const sales = await rpmRepo.readRpmSales({});
  const hangupSales = sales.filter((s) => {
    const unit = String(s.unit || s.formData?.unit || "");
    return !/^HS2|HS-2|PT/i.test(unit);
  });

  const { checks: existing } = await rpmChecksRepo.listChecks({
    company: "hangup",
    limit: 5000,
  });
  const existingKeys = new Set();
  const linkedSaleIds = new Set();
  for (const c of existing || []) {
    const m = String(c.info || "").match(/\[import:([^\]]+)\]/);
    if (m) existingKeys.add(m[1]);
    if (c.linkedRpmSaleId) linkedSaleIds.add(c.linkedRpmSaleId);
  }

  function matchSale({ memberId, phone, workingDay }) {
    const mid = stripMemberId(memberId);
    const ph = normalizePhone(phone);
    const candidates = hangupSales.filter((s) => {
      if (linkedSaleIds.has(s.id)) return false;
      const smid = stripMemberId(s.memberId || s.formData?.memberId);
      const sph = normalizePhone(s.phoneNumber || s.formData?.phoneNumber);
      if (mid && smid && mid === smid) return true;
      if (ph && sph && ph === sph) return true;
      return false;
    });
    if (!candidates.length) return null;
    if (workingDay) {
      const sameDay = candidates.filter(
        (s) => String(s.workingDay || s.submissionDate || "").slice(0, 10) === workingDay
      );
      if (sameDay.length) return sameDay[0];
    }
    return candidates.sort((a, b) =>
      String(a.createdAt || a.submissionDate || "").localeCompare(String(b.createdAt || b.submissionDate || ""))
    )[0];
  }

  let created = 0;
  let skipped = 0;
  let linked = 0;
  let errors = 0;

  async function writeCheck(payload) {
    const key = payload.importKey;
    if (key && existingKeys.has(key)) {
      skipped += 1;
      return null;
    }
    const info = [payload.info || "", key ? `[import:${key}]` : ""].filter(Boolean).join("\n").trim();
    try {
      const check = await rpmChecksRepo.createCheck({
        company: "hangup",
        agentId: payload.agentId,
        memberId: payload.memberId || null,
        fullName: payload.fullName || null,
        dateOfBirth: payload.dateOfBirth || null,
        phone: payload.phone || null,
        team: payload.team || null,
        unit: payload.unit || null,
        checkStatus: payload.checkStatus,
        info,
        submittedBy: "import:xlsx",
        closerId: payload.closerId || null,
        workingDay: payload.workingDay,
        submissionDate: payload.submissionDate || payload.workingDay,
        createdAt:
          payload.createdAt ||
          (payload.workingDay ? `${payload.workingDay}T12:00:00.000Z` : null),
      });
      existingKeys.add(key);
      agentDayHasChecks.add(`${payload.agentId}|${payload.workingDay}`);
      created += 1;

      if (payload.feedbackStatus) {
        await rpmChecksRepo.setFeedback(check.id, {
          feedbackStatus: payload.feedbackStatus,
          info,
          closerId: payload.closerId || null,
          feedbackBy: "import:xlsx",
        });
      }
      if (payload.saleId) {
        const linkedRow = await rpmChecksRepo.linkSaleToCheck(check.id, payload.saleId);
        if (linkedRow) {
          linkedSaleIds.add(payload.saleId);
          linked += 1;
        }
      }
      return check;
    } catch (err) {
      errors += 1;
      console.error("create failed", key, err.message || err);
      return null;
    }
  }

  // 1) HS3 Daily first — source of truth for Checks page
  for (const row of hs3Rows) {
    const agent = findEmployeeByName(employees, row.agentName);
    if (!agent) {
      skipped += 1;
      continue;
    }
    const statuses = [
      ...Array(row.q).fill("q"),
      ...Array(row.nq).fill("nq"),
      ...Array(row.age_limit).fill("age_limit"),
      ...Array(row.duplicate).fill("duplicate"),
    ];
    let i = 0;
    for (const checkStatus of statuses) {
      i += 1;
      await writeCheck({
        importKey: `${row.importKey}:${checkStatus}:${i}`,
        agentId: agent.id,
        memberId: "",
        fullName: "",
        phone: "",
        team: row.team || agent.team || "",
        unit: agent.unit || "",
        checkStatus,
        feedbackStatus: null,
        closerId: null,
        workingDay: row.workingDay,
        createdAt: row.workingDay ? `${row.workingDay}T12:00:00.000Z` : null,
        info: `HS3 Daily placeholder for ${row.agentName}`,
        saleId: null,
      });
    }
  }

  // 2) Q Feedback sheet — Q Feedback page only (tagged; Checks UI excludes these)
  for (const row of qfbRows) {
    if (!row.workingDay) {
      skipped += 1;
      continue;
    }
    const sale = matchSale({
      memberId: row.memberId,
      phone: row.phone,
      workingDay: row.workingDay,
    });
    const closer = findEmployeeByName(employees, row.closerName);
    let agent =
      (sale && employees.find((e) => e.id === sale.agentId)) ||
      findTeamAgent(employees, teamsMeta, row.team);
    if (!agent) agent = closer;
    if (!agent) {
      console.warn("No agent for QFB row", row.rowIndex, row.team, row.phone);
      skipped += 1;
      continue;
    }

    let checkStatus = row.checkStatus;
    let feedbackStatus = row.feedbackStatus;
    if (sale && !feedbackStatus) {
      feedbackStatus = "sale";
      checkStatus = "q";
    }
    // Leave Qs with no disposition as open (no feedback) — do not invent Dropped.

    await writeCheck({
      importKey: row.importKey,
      agentId: agent.id,
      memberId: row.memberId || sale?.memberId || sale?.formData?.memberId || "",
      fullName: row.fullName || sale?.fullName || sale?.formData?.fullName || "",
      phone: row.phone || sale?.phoneNumber || "",
      team: row.team || agent.team || sale?.team || "",
      unit: agent.unit || sale?.unit || "",
      checkStatus,
      feedbackStatus,
      closerId: closer?.id || sale?.closerId || null,
      workingDay: row.workingDay,
      createdAt: row.createdAt || null,
      info: `${row.info || ""}\n[source:q-feedback-sheet]`.trim(),
      saleId: sale?.id || null,
    });
  }

  console.log({ created, linked, skipped, errors, mode: apply ? "apply" : "dry-run" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
