/**
 * Clear fake "dropped_with_client" on HS3 Daily placeholder Qs so Checks shows No feedback.
 * Usage: node scripts/clear-hs3-legacy-dropped-feedback.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("rpm_checks")
    .select("id, info, submitted_by, feedback_by, feedback_status, check_status")
    .is("deleted_at", null)
    .eq("check_status", "q")
    .eq("feedback_status", "dropped_with_client")
    .limit(5000);
  if (error) throw error;

  const targets = (data || []).filter((r) => {
    const info = String(r.info || "");
    const by = String(r.feedback_by || "");
    const sub = String(r.submitted_by || "");
    return (
      by === "import:hs3-daily-legacy-close" ||
      sub === "import:hs3-daily" ||
      info.includes("HS3 Daily placeholder") ||
      info.includes("[import:hs3:")
    );
  });

  console.log("Clearing feedback on", targets.length, "HS3 placeholder Qs");
  let cleared = 0;
  for (const row of targets) {
    const { error: upErr } = await db
      .from("rpm_checks")
      .update({
        feedback_status: null,
        feedback_by: null,
        feedback_at: null,
        closer_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .is("deleted_at", null);
    if (upErr) throw upErr;
    cleared += 1;
  }
  console.log({ cleared });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
