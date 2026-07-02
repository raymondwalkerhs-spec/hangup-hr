#!/usr/bin/env node
/**
 * Import June 2026 sales from MLA-Ray status CSV into Supabase.
 * Usage: node scripts/import-june-sales.js [--dry-run]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("../lib/supabase-client");

const CSV_PATH = path.join(__dirname, "..", "june sales", "MLA-Ray status View.csv");
const DRY_RUN = process.argv.includes("--dry-run");
const SUBMITTED_BY = "import-june-sales";

const CLOSER_ALIASES = {
  jude: "TL07",
  tris: "TL03",
  ayla: "HS1-05",
  steven: "OP1",
  "self-closer": null,
  "self closer": null,
};

const STATUS_MAP = {
  passed: "passed",
  processed: "passed",
  postdated: "postdated",
  dropped: "denied",
  "pending bank approval": "pending",
  retransfer: "callback",
};

const DEVICE_MAP = {
  necklace: "necklace",
  smartwatch: "smartwatch",
  bracelet: "bracelet",
};

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Known CSV name → employee id overrides (spelling / accent mismatches). */
const AGENT_ID_OVERRIDES = {
  "ryan neil": "NW-18",
  "sarah gonzalez": "HS1-12",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || (c === "\r" && next === "\n")) {
      row.push(field);
      field = "";
      if (row.some((v) => String(v).trim())) rows.push(row);
      row = [];
      if (c === "\r") i++;
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((v) => String(v).trim())) rows.push(row);
  }
  return rows;
}

function parseSubmissionDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

function parseBillingDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

function mapStatus(raw) {
  const key = norm(raw);
  return STATUS_MAP[key] || (key ? "pending" : "pending");
}

function mapDevice(raw) {
  const key = norm(raw);
  return DEVICE_MAP[key] || "necklace";
}

function mapUnit(centerCode) {
  const c = String(centerCode || "").trim().toUpperCase();
  if (c === "HS3") return "HS-3";
  if (c === "HS1") return "HS-1";
  if (c === "HS2") return "HS-2";
  return c || "HS-3";
}

function buildEmployeeIndex(employees) {
  const byName = new Map();
  for (const e of employees) {
    const key = norm(e.american_name);
    if (key) byName.set(key, e);
  }
  return byName;
}

function findEmployee(byName, employees, agentName) {
  const key = norm(agentName);
  const overrideId = AGENT_ID_OVERRIDES[key];
  if (overrideId) {
    const hit = employees.find((e) => e.id === overrideId);
    if (hit) return hit;
  }
  if (byName.has(key)) return byName.get(key);
  for (const [k, e] of byName) {
    if (k.replace(/[^a-z]/g, "") === key.replace(/[^a-z]/g, "")) return e;
  }
  return null;
}

function nextHs3Id(employees) {
  let max = 0;
  for (const e of employees) {
    const m = String(e.id).match(/^HS3-(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `HS3-${String(max + 1).padStart(2, "0")}`;
}

async function main() {
  const db = getSupabaseAdmin();
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const table = parseCsv(csvText);
  const headers = table[0];
  const dataRows = table.slice(1);

  const col = (row, name) => {
    const i = headers.findIndex((h) => norm(h).startsWith(norm(name)));
    return i >= 0 ? row[i] : "";
  };

  const { data: employees, error: empErr } = await db.from("employees").select("id, american_name, team, unit");
  if (empErr) throw new Error(empErr.message);

  const byName = buildEmployeeIndex(employees);
  const teamVotes = new Map();
  const toCreate = [];
  const parsed = [];

  for (const row of dataRows) {
    const agentName = String(col(row, "Agent Name")).trim();
    const team = String(col(row, "Team")).trim();
    if (!agentName) continue;

    let emp = findEmployee(byName, employees, agentName);
    if (!emp) {
      const pending = toCreate.find((x) => norm(x.american_name) === norm(agentName));
      if (!pending) {
        const id = nextHs3Id([...employees, ...toCreate]);
        const stub = {
          id,
          american_name: agentName,
          unit: mapUnit(col(row, "Center Code")),
          team,
          position: "Agent",
          status: "Active",
        };
        toCreate.push(stub);
        byName.set(norm(agentName), stub);
        emp = stub;
      } else {
        emp = pending;
      }
    }

    if (team) {
      const votes = teamVotes.get(emp.id) || {};
      votes[team] = (votes[team] || 0) + 1;
      teamVotes.set(emp.id, votes);
    }

    const submissionDate = parseSubmissionDate(col(row, "Submission Date"));
    const billingDate = parseBillingDate(col(row, "Billing Date"));
    const firstName = String(col(row, "First Name")).trim();
    const lastName = String(col(row, "Last Name")).trim();
    const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim() || "Unknown";
    const closerRaw = String(col(row, "Closer Name")).trim();
    const closerKey = norm(closerRaw);
    let closerId = CLOSER_ALIASES[closerKey];
    if (closerId === undefined) {
      const closerEmp = findEmployee(byName, employees, closerRaw);
      closerId = closerEmp ? closerEmp.id : null;
    }

    const feedback = [col(row, "Client Feedback"), col(row, "Quality Comments")]
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .join(" | ");

    parsed.push({
      phone_number: String(col(row, "Phone Number")).trim(),
      full_name: fullName,
      device: mapDevice(col(row, "Device Type")),
      client: String(col(row, "Client")).trim(),
      agent_id: emp.id,
      closer_id: closerId,
      submitted_by: SUBMITTED_BY,
      status: mapStatus(col(row, "Client Feedback")),
      submission_date: submissionDate || billingDate || "2026-06-01",
      effective_date: billingDate || submissionDate || "2026-06-01",
      feedback,
      team,
      unit: mapUnit(col(row, "Center Code")),
    });
  }

  const teamUpdates = [];
  for (const [empId, votes] of teamVotes) {
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!best) continue;
    const emp = employees.find((e) => e.id === empId) || toCreate.find((e) => e.id === empId);
    if (emp && emp.team !== best) {
      teamUpdates.push({ id: empId, team: best, american_name: emp.american_name });
    }
  }

  console.log(`Parsed ${parsed.length} sales rows`);
  console.log(`New employees to create: ${toCreate.length}`);
  for (const e of toCreate) console.log(`  + ${e.id} — ${e.american_name} (${e.team})`);
  console.log(`Team updates: ${teamUpdates.length}`);
  for (const u of teamUpdates) console.log(`  ~ ${u.id} — ${u.american_name}: → ${u.team}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: no database writes");
    return;
  }

  if (toCreate.length) {
    const { error } = await db.from("employees").insert(toCreate);
    if (error) throw new Error(`create employees: ${error.message}`);
    console.log(`Created ${toCreate.length} employees`);
  }

  for (const u of teamUpdates) {
    const { error } = await db.from("employees").update({ team: u.team }).eq("id", u.id);
    if (error) throw new Error(`update team ${u.id}: ${error.message}`);
  }
  if (teamUpdates.length) console.log(`Updated ${teamUpdates.length} employee teams`);

  const { data: existing } = await db.from("sales").select("phone_number, submission_date").eq("submitted_by", SUBMITTED_BY);
  const existingKeys = new Set((existing || []).map((s) => `${s.phone_number}|${s.submission_date}`));

  const toInsert = parsed.filter((s) => !existingKeys.has(`${s.phone_number}|${s.submission_date}`));
  const CHUNK = 50;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const slice = toInsert.slice(i, i + CHUNK);
    const { error } = await db.from("sales").insert(slice);
    if (error) throw new Error(`insert sales: ${error.message}`);
    inserted += slice.length;
  }
  console.log(`Inserted ${inserted} sales (${parsed.length - toInsert.length} skipped as duplicates)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
