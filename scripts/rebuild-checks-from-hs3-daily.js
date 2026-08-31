/**
 * Rebuild RPM checks from HS3 Daily with strict per-agent, per-day counts.
 *
 *   node scripts/rebuild-checks-from-hs3-daily.js --apply
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const apply = process.argv.includes("--apply");
const hs3Path = path.resolve(process.cwd(), "Asset/Copy of HS3 Dashboard August.xlsx");
const qfbPath = path.resolve(process.cwd(), "Asset/RPM Q Feedback.xlsx");

/** Sheet name → employee american_name (known typos / renames). */
const AGENT_ALIASES = {
  jennifer: "Jeniffer Robert",
  "john philips": "JOHN BENNETT",
  "john phillips": "JOHN BENNETT",
  "marry adams": "Marry Addams",
  "laura williams": "Laura Wiiliams",
  "taylor adams": "TAYLOR JAMES",
  "julitte aaron": "jullitte aaron",
  "juliette aaron": "jullitte aaron",
  noah: "NOAH ADAM",
  adam: "ADAM PARKER",
};

function excelSerialToIso(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}

function excelSerialToDateTime(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const whole = Math.floor(n);
  const frac = n - whole;
  return new Date(Date.UTC(1899, 11, 30) + whole * 86400000 + Math.round(frac * 86400000));
}

function parseSheetDay(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) return excelSerialToIso(ts);
  const s = String(ts || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function hashKey(parts) {
  return crypto.createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
}

function nameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEmployeeIndex(employees) {
  const byKey = new Map();
  const byId = new Map();
  for (const e of employees) {
    byId.set(e.id, e);
    const k = nameKey(e.american_name);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }
  return { byKey, byId };
}

function resolveAgent(employees, index, agentName, team) {
  const raw = String(agentName || "").trim();
  if (!raw) return null;
  const key = nameKey(raw);
  const aliasTo = AGENT_ALIASES[key];
  const want = aliasTo ? nameKey(aliasTo) : key;

  const teamKey = nameKey(team).replace(/^triss$/, "tris");

  function pick(list) {
    if (!list?.length) return null;
    if (list.length === 1) return list[0];
    if (teamKey) {
      const onTeam = list.filter((e) => {
        const et = nameKey(e.team).replace(/^triss$/, "tris");
        if (!et) return false;
        return et === teamKey || et.includes(teamKey) || teamKey.includes(et);
      });
      if (onTeam.length === 1) return onTeam[0];
      if (onTeam.length > 1) {
        const active = onTeam.filter((e) => String(e.status || "").toLowerCase() === "active");
        return active[0] || onTeam[0];
      }
    }
    const active = list.filter((e) => String(e.status || "").toLowerCase() === "active");
    return active[0] || list[0];
  }

  // Exact key
  let hit = pick(index.byKey.get(want));
  if (hit) return hit;

  // Alias exact on original
  if (aliasTo) {
    hit = pick(index.byKey.get(nameKey(aliasTo)));
    if (hit) return hit;
  }

  // Single-token exact only when unique among HS-3 (avoid Noah/Adam collisions)
  if (!key.includes(" ")) {
    const tokenHits = employees.filter((e) => {
      const tokens = nameKey(e.american_name).split(" ").filter(Boolean);
      return tokens[0] === key || tokens.includes(key);
    });
    const scoped = teamKey
      ? tokenHits.filter((e) => {
          const et = nameKey(e.team).replace(/^triss$/, "tris");
          if (!et) return false;
          return et === teamKey || et.includes(teamKey) || teamKey.includes(et);
        })
      : tokenHits;
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) {
      const active = scoped.filter((e) => String(e.status || "").toLowerCase() === "active");
      if (active.length === 1) return active[0];
      return active[0] || scoped[0];
    }
    if (!teamKey && tokenHits.length === 1) return tokenHits[0];
  }

  // Typo-tolerant: all sheet tokens present in employee name (order-free)
  const tokens = key.split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    const fuzzy = employees.filter((e) => {
      const en = nameKey(e.american_name);
      return tokens.every((t) => en.includes(t) || [...en.split(" ")].some((et) => levenshtein(et, t) <= 1));
    });
    hit = pick(fuzzy);
    if (hit) return hit;
  }

  return null;
}

function levenshtein(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = a[i - 1] === b[j - 1] ? row[j - 1] : 1 + Math.min(row[j - 1], row[j], prev);
      row[j - 1] = prev;
      prev = cur;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

function readHs3Daily(XLSX) {
  if (!fs.existsSync(hs3Path)) throw new Error(`Missing ${hs3Path}`);
  const wb = XLSX.readFile(hs3Path);
  const sheet = wb.Sheets.Daily;
  if (!sheet) throw new Error("Daily sheet missing");
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const out = [];
  let currentDay = null;
  let inAgentTable = false;
  let currentTeam = "";
  for (let i = 0; i < grid.length; i++) {
    const r = grid[i];
    if (typeof r[0] === "number" && r[0] > 40000) {
      currentDay = excelSerialToIso(r[0]);
      inAgentTable = false;
      currentTeam = "";
      continue;
    }
    if (!currentDay) continue;
    const c0 = String(r[0] || "").trim();
    const c1 = String(r[1] || "").trim();
    if (/^team$/i.test(c0) && /^agent name$/i.test(c1)) {
      inAgentTable = true;
      currentTeam = "";
      continue;
    }
    if (!inAgentTable) continue;
    if (/^total$/i.test(c0)) {
      inAgentTable = false;
      currentTeam = "";
      continue;
    }
    if (/^agents/i.test(c0) || /interval/i.test(c0)) {
      inAgentTable = false;
      currentTeam = "";
      continue;
    }
    if (/^team$/i.test(c0) && !c1) {
      inAgentTable = false;
      currentTeam = "";
      continue;
    }
    const agentName = c1;
    if (!agentName) continue;
    if (c0) currentTeam = c0;
    const team = currentTeam;
    const dup = Number(r[3]) || 0;
    const age = Number(r[4]) || 0;
    const q = Number(r[5]) || 0;
    const nq = Number(r[6]) || 0;
    const totalChecks = Number(r[7]) || 0;
    // Status columns are source of truth. Total Checks = Q+NQ+Age+Under+Dup.
    const expected = q + nq + age + dup;
    if (!expected && !totalChecks) continue;
    out.push({
      workingDay: currentDay,
      agentName,
      team,
      duplicate: dup,
      age_limit: age,
      q,
      nq,
      expected,
      sheetTotalChecks: totalChecks,
      importKey: `hs3:${hashKey([currentDay, agentName, team])}`,
    });
  }
  return out;
}

function readQFeedback(XLSX) {
  if (!fs.existsSync(qfbPath)) return [];
  const { computeWorkingDay } = require("../lib/sales-working-day");
  const { normalizeCheckStatus, normalizeFeedbackStatus } = require("../lib/rpm-check-status");
  const wb = XLSX.readFile(qfbPath);
  const sheetName =
    wb.SheetNames.find((n) => n === "All") ||
    wb.SheetNames.find((n) => /feedback/i.test(n)) ||
    wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

  function mapFeedbackRaw(raw) {
    const s = String(raw || "").trim();
    const check = normalizeCheckStatus(s);
    if (check) return { checkStatus: check, feedbackStatus: null };
    const fb = normalizeFeedbackStatus(s);
    if (fb) return { checkStatus: "q", feedbackStatus: fb };
    if (/^sale$/i.test(s)) return { checkStatus: "q", feedbackStatus: "sale" };
    return { checkStatus: "q", feedbackStatus: null };
  }

  function extractMemberId(info) {
    const { stripMemberId, validateMemberId } = require("../lib/rpm-member-id");
    const text = String(info || "").toUpperCase();
    const candidates = text.match(/[0-9A-Z]{11}/g) || [];
    for (const c of candidates) {
      const v = validateMemberId(c, { required: false });
      if (v.ok && v.value) return v.value;
    }
    for (const c of candidates) {
      const s = stripMemberId(c);
      if (s.length === 11) return s;
    }
    return "";
  }

  function extractNameFromInfo(info) {
    const text = String(info || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const nearId = text.match(
      /([A-Za-z][A-Za-z'’.\-]+(?:\s+[A-Za-z][A-Za-z'’.\-]+){1,3})\s+[0-9A-Za-z]{11}/
    );
    return nearId ? nearId[1].trim() : "";
  }

  return rows.map((row, idx) => {
    const ts = row.Timestamp || row.timestamp || row.Date || row.date;
    let calendarDay = parseSheetDay(ts);
    let createdAt = null;
    let submission = calendarDay ? `${calendarDay} 12:00:00` : null;
    if (typeof ts === "number") {
      const dt = excelSerialToDateTime(ts);
      if (dt) {
        createdAt = dt.toISOString();
        const whole = Math.floor(ts);
        const frac = ts - whole;
        const secs = Math.round(frac * 86400);
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        calendarDay = excelSerialToIso(ts);
        submission = `${calendarDay} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }
    }
    const workingDay = submission ? computeWorkingDay(submission) : calendarDay;
    const info = String(row.Info || row.info || "");
    const mapped = mapFeedbackRaw(row.Feedback || row.feedback || "");
    return {
      rowIndex: idx + 2,
      workingDay,
      createdAt: createdAt || (workingDay ? `${workingDay}T12:00:00.000Z` : null),
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

async function loadEmployees(db) {
  const { data, error } = await db
    .from("employees")
    .select("id, american_name, team, unit, status")
    .limit(8000);
  if (error) throw new Error(error.message);
  return (data || []).map((e) => ({
    id: e.id,
    american_name: e.american_name,
    team: e.team,
    unit: e.unit,
    status: e.status,
  }));
}

async function softDeleteImports(db) {
  let removed = 0;
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("rpm_checks")
      .select("id")
      .ilike("info", "%[import:%")
      .is("deleted_at", null)
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    const batch = data || [];
    if (!batch.length) break;
    const ids = batch.map((r) => r.id);
    const { error: upErr } = await db
      .from("rpm_checks")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in("id", ids);
    if (upErr) throw new Error(upErr.message);
    removed += ids.length;
    if (batch.length < 500) break;
    // don't advance from — rows are no longer matching is null
  }
  return removed;
}

async function main() {
  const XLSX = require("xlsx");
  const rpmChecksRepo = require("../lib/rpm-checks-repo");
  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const db = getSupabaseAdmin();

  const employees = await loadEmployees(db);
  const index = buildEmployeeIndex(employees);
  const otherEmp = employees.find((e) => e.id === "OTHER") || null;

  let teamsMeta = [];
  try {
    teamsMeta = await require("../lib/hrms-repo").readOrgTeams();
  } catch {
    teamsMeta = [];
  }

  const hs3Rows = readHs3Daily(XLSX);
  const qfbRows = readQFeedback(XLSX);

  let expectedChecks = 0;
  const unresolved = [];
  for (const row of hs3Rows) {
    expectedChecks += row.expected;
    const agent = resolveAgent(employees, index, row.agentName, row.team);
    if (!agent) unresolved.push(row);
  }

  console.log({
    hs3AgentDays: hs3Rows.length,
    expectedDailyChecks: expectedChecks,
    unresolvedAgents: unresolved.length,
    unresolvedSample: unresolved.slice(0, 20).map((r) => `${r.workingDay} ${r.agentName} (${r.team}) q${r.q}/nq${r.nq}`),
    qfbRows: qfbRows.length,
    mode: apply ? "apply" : "dry-run",
  });

  if (!apply) {
    console.log("Dry-run only. Re-run with --apply.");
    return;
  }

  const removed = await softDeleteImports(db);
  console.log("Soft-deleted imports:", removed);

  let createdDaily = 0;
  let usedOther = 0;
  const dayTotals = {};

  for (const row of hs3Rows) {
    let agent = resolveAgent(employees, index, row.agentName, row.team);
    if (!agent) {
      if (!otherEmp) throw new Error(`No employee for ${row.agentName} and no OTHER fallback`);
      agent = otherEmp;
      usedOther += 1;
      console.warn("Using OTHER for", row.workingDay, row.agentName, row.team);
    }
    const statuses = [
      ...Array(row.q).fill("q"),
      ...Array(row.nq).fill("nq"),
      ...Array(row.age_limit).fill("age_limit"),
      ...Array(row.duplicate).fill("duplicate"),
    ];
    // If Total Checks > sum of typed columns, pad as NQ (shouldn't happen)
    while (statuses.length < row.expected) statuses.push("nq");

    let i = 0;
    for (const checkStatus of statuses) {
      i += 1;
      const stamp = `${row.workingDay}T12:00:00.000Z`;
      const check = await rpmChecksRepo.createCheck({
        company: "hangup",
        agentId: agent.id,
        memberId: null,
        fullName: null,
        phone: null,
        team: row.team || agent.team || "",
        unit: agent.unit || "HS-3",
        checkStatus,
        info: `HS3 Daily placeholder for ${row.agentName}\n[import:${row.importKey}:${checkStatus}:${i}]\n[sheet-agent:${row.agentName}]`,
        submittedBy: "import:hs3-daily",
        workingDay: row.workingDay,
        submissionDate: row.workingDay,
        createdAt: stamp,
      });
      createdDaily += 1;
      dayTotals[row.workingDay] = (dayTotals[row.workingDay] || 0) + 1;
    }
  }

  // Q Feedback sheet rows (Checks page excludes these)
  function findEmployeeByName(name) {
    return resolveAgent(employees, index, name, "");
  }
  function findTeamAgent(teamName) {
    const { teamsMatch, employeeTeamKey } = require("../lib/team-names");
    const onTeam = employees.filter((e) => teamsMatch(employeeTeamKey(e, teamsMeta), teamName));
    if (!onTeam.length) return null;
    const { isDialingAgent } = require("../lib/dialing-agents");
    try {
      const dialing = onTeam.filter((e) => isDialingAgent(e, { activeOnly: false }));
      return dialing[0] || onTeam[0];
    } catch {
      return onTeam[0];
    }
  }

  let createdQfb = 0;
  let skippedQfb = 0;
  for (const row of qfbRows) {
    if (!row.workingDay) {
      skippedQfb += 1;
      continue;
    }
    const closer = findEmployeeByName(row.closerName);
    const agent = findTeamAgent(row.team) || closer || otherEmp;
    if (!agent) {
      skippedQfb += 1;
      continue;
    }
    const check = await rpmChecksRepo.createCheck({
      company: "hangup",
      agentId: agent.id,
      memberId: row.memberId || null,
      fullName: row.fullName || null,
      phone: row.phone || null,
      team: row.team || agent.team || "",
      unit: agent.unit || "",
      checkStatus: row.checkStatus,
      info: [row.info || "", `[import:${row.importKey}]`, "[source:q-feedback-sheet]"].filter(Boolean).join("\n"),
      submittedBy: "import:qfb-sheet",
      closerId: closer?.id || null,
      workingDay: row.workingDay,
      submissionDate: row.workingDay,
      createdAt: row.createdAt,
    });
    createdQfb += 1;
    if (row.feedbackStatus) {
      await rpmChecksRepo.setFeedback(check.id, {
        feedbackStatus: row.feedbackStatus,
        info: check.info,
        closerId: closer?.id || null,
        feedbackBy: "import:qfb-sheet",
      });
      if (row.createdAt) {
        await db
          .from("rpm_checks")
          .update({ feedback_at: row.createdAt, created_at: row.createdAt })
          .eq("id", check.id);
      }
    }
  }

  console.log({ createdDaily, createdQfb, skippedQfb, usedOther, dayTotals });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
