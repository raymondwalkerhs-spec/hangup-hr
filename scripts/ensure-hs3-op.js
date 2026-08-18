#!/usr/bin/env node
/**
 * Ensure OP1 Steven is listed as OP for HS-3 (idempotent unit_ops upsert).
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const teamTlsRepo = require("../lib/team-tls-repo");

async function main() {
  const db = getSupabaseAdmin();
  const { data: emps, error } = await db
    .from("employees")
    .select("id, american_name, unit, status")
    .or("id.eq.OP1,id.eq.OP1-01,id.ilike.OP1%,american_name.ilike.%Steven%");
  if (error) throw error;

  const rows = emps || [];
  const steven =
    rows.find((e) => String(e.id).toUpperCase() === "OP1") ||
    rows.find((e) => String(e.id).toUpperCase() === "OP1-01") ||
    rows.find((e) => /^OP1/i.test(e.id) && /steven/i.test(e.american_name || "")) ||
    rows.find((e) => /steven/i.test(e.american_name || ""));

  if (!steven) {
    console.error("Could not find OP1 / Steven in employees:", rows.map((e) => `${e.id} ${e.american_name}`));
    process.exit(1);
  }

  const existing = await teamTlsRepo.readUnitOps("HS-3");
  const already = existing.includes(steven.id);
  if (!already) {
    await teamTlsRepo.addUnitOp("HS-3", steven.id);
  }
  const after = await teamTlsRepo.readUnitOps("HS-3");
  console.log(
    JSON.stringify(
      {
        employeeId: steven.id,
        name: steven.american_name,
        homeUnit: steven.unit,
        alreadyAssigned: already,
        hs3Ops: after,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
