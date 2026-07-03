#!/usr/bin/env node
/** Apply phase-4 migration: identity columns, training_passed, Aurora photo, backfill IDs. */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function runSql(sql) {
  const url = process.env.SUPABASE_URL || "";
  const ref = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) throw new Error("Need SUPABASE_URL + SUPABASE_ACCESS_TOKEN");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 800));
  return text;
}

async function main() {
  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const db = getSupabaseAdmin();
  const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "hr-documents";

  const probe = await db.from("employees").select("training_passed").limit(1);
  if (probe.error && /training_passed|column/.test(probe.error.message)) {
    const sql = fs.readFileSync(
      path.join(__dirname, "../supabase/migrations/20260714_registration_identity_training.sql"),
      "utf8"
    );
    console.log("Applying 20260714_registration_identity_training.sql...");
    await runSql(sql);
    console.log("Migration OK");
  } else if (probe.error) {
    throw new Error(probe.error.message);
  } else {
    console.log("Identity/training columns already present.");
  }

  const { data: employees, error: empErr } = await db.from("employees").select("id,nationality,identification,national_id,training_passed");
  if (empErr) throw new Error(empErr.message);

  let idBackfill = 0;
  for (const emp of employees || []) {
    const patch = {};
    const nat = String(emp.nationality || "").toLowerCase();
    const egyptian = nat === "egyptian" || nat === "egypt" || nat === "egyptain";
    if (egyptian && emp.identification && !emp.national_id) {
      patch.national_id = String(emp.identification).trim();
      idBackfill += 1;
    }
    if (Object.keys(patch).length) {
      const { error } = await db.from("employees").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", emp.id);
      if (error) console.warn(`Skip ${emp.id}:`, error.message);
    }
  }
  try {
    await runSql("UPDATE employees SET training_passed = true WHERE training_passed IS NOT TRUE;");
    console.log("Marked all employees training_passed via SQL.");
  } catch (e) {
    console.warn("training_passed SQL:", e.message);
  }
  console.log(`Backfilled national_id for ${idBackfill} employees.`);

  const photoPath = "profile-photos/HR-1/1782986243892-file (9).jpg";
  const { data: aurora } = await db.from("employees").select("id,profile_photo_file_id").eq("id", "HR-1").maybeSingle();
  if (aurora && !aurora.profile_photo_file_id) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(photoPath, 60 * 60 * 24 * 7);
    const { error } = await db
      .from("employees")
      .update({
        profile_photo_file_id: photoPath,
        profile_photo_link: signed?.signedUrl || null,
        profile_photo_updated: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", "HR-1");
    if (error) throw new Error(`Aurora photo: ${error.message}`);
    console.log("Linked Aurora (HR-1) profile photo from storage.");
  } else if (aurora?.profile_photo_file_id) {
    console.log("Aurora already has profile photo:", aurora.profile_photo_file_id);
  } else {
    console.warn("HR-1 employee not found — skip Aurora photo.");
  }

  console.log("Phase 4 data updates complete.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
