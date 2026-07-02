#!/usr/bin/env node
/**
 * Seed employee fp_number from Asset/june fp example.xls
 * Usage: node scripts/seed-june-fp-mappings.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { normalizeFpNumber } = require("../lib/attendance-fp-import");

const FILE = path.join(__dirname, "..", "Asset", "june fp example.xls");

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`File not found: ${FILE}`);
    console.error("Place your device export at Asset/june fp example.xls and re-run.");
    process.exit(1);
  }
  const buf = fs.readFileSync(FILE);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headers = (rows[0] || []).map((h) => String(h).toLowerCase());
  const fpIdx = headers.findIndex((h) => h.includes("fp") || h.includes("id") || h.includes("enroll"));
  const nameIdx = headers.findIndex((h) => h.includes("name"));
  if (fpIdx < 0) {
    console.error("Could not find FP/ID column in header:", headers);
    process.exit(1);
  }

  const mappings = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fp = normalizeFpNumber(row[fpIdx]);
    const name = nameIdx >= 0 ? String(row[nameIdx] || "").trim() : "";
    if (!fp) continue;
    mappings.push({ fp, name });
  }

  const db = getSupabaseAdmin();
  const { data: employees, error } = await db.from("employees").select("id, american_name, arabic_name, fp_number");
  if (error) throw new Error(error.message);

  let matched = 0;
  const unmatched = [];
  for (const m of mappings) {
    const nn = normName(m.name);
    let emp = (employees || []).find((e) => normName(e.american_name) === nn || normName(e.arabic_name) === nn);
    if (!emp && nn) {
      emp = (employees || []).find(
        (e) => normName(e.american_name).includes(nn) || nn.includes(normName(e.american_name))
      );
    }
    if (!emp) {
      unmatched.push(m);
      continue;
    }
    if (emp.fp_number === m.fp) continue;
    const { error: updErr } = await db.from("employees").update({ fp_number: m.fp }).eq("id", emp.id);
    if (updErr) throw new Error(updErr.message);
    console.log(`✓ ${emp.id} ← FP ${m.fp} (${m.name || emp.american_name})`);
    matched++;
  }
  console.log(`\nDone: ${matched} updated, ${unmatched.length} unmatched`);
  if (unmatched.length) {
    console.log("Unmatched (assign FP manually in employee profile):");
    unmatched.forEach((u) => console.log(`  FP ${u.fp} — ${u.name || "?"}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
