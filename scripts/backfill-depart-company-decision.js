#!/usr/bin/env node
/**
 * Backfill all previously departed employees to notice_type = company_decision.
 * Uses Supabase when available; pass --apply to write.
 */
require("dotenv").config();

async function main() {
  const apply = process.argv.includes("--apply");
  const { useSupabase } = require("../lib/backend");

  if (!useSupabase()) {
    console.error("Supabase backend required for backfill.");
    process.exit(1);
  }

  const { createClient } = require("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or key.");
    process.exit(1);
  }

  const db = createClient(url, key);
  const { data, error } = await db
    .from("employees")
    .select("id, status, depart_date, notice_type")
    .not("depart_date", "is", null);

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const out = (data || []).filter((e) => {
    const st = String(e.status || "").toLowerCase();
    return st === "out" || st.includes("still get paid");
  });

  const toUpdate = out.filter((e) => String(e.notice_type || "").toLowerCase() !== "company_decision");

  console.log(`Found ${out.length} departed employees; ${toUpdate.length} need company_decision backfill.`);
  for (const emp of toUpdate) {
    console.log(`  ${emp.id}  depart=${emp.depart_date}  current=${emp.notice_type || "(blank)"}`);
  }

  if (!apply) {
    console.log("\nDry run — pass --apply to update.");
    return;
  }

  const ids = toUpdate.map((e) => e.id);
  if (!ids.length) {
    console.log("Nothing to update.");
    return;
  }

  const { error: updErr } = await db.from("employees").update({ notice_type: "company_decision" }).in("id", ids);
  if (updErr) {
    console.error("Update failed:", updErr.message);
    process.exit(1);
  }

  console.log(`Updated ${ids.length} employees to company_decision.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
