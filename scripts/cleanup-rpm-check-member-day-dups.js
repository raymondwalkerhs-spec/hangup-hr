/**
 * Soft-delete rpm_checks losers for (company, member_id_normalized, working_day)
 * via the repo so Airtable delete hooks run. Idempotent after SQL migration.
 *
 * Usage: node scripts/cleanup-rpm-check-member-day-dups.js [--dry-run]
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const rpmChecksRepo = require("../lib/rpm-checks-repo");

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const db = getSupabaseAdmin();
  let from = 0;
  const page = 1000;
  let all = [];
  for (;;) {
    const { data, error } = await db
      .from("rpm_checks")
      .select("id, company, member_id_normalized, working_day, linked_rpm_sale_id, feedback_status, created_at, deleted_at")
      .is("deleted_at", null)
      .not("member_id_normalized", "is", null)
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data?.length) break;
    all = all.concat(data);
    if (data.length < page) break;
    from += page;
  }

  const groups = new Map();
  for (const row of all) {
    const norm = String(row.member_id_normalized || "").trim();
    if (!norm) continue;
    const key = `${row.company}|${norm}|${row.working_day}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const losers = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => {
      const score = (r) => (r.linked_rpm_sale_id || r.feedback_status === "sale" ? 0 : 1);
      const s = score(a) - score(b);
      if (s) return s;
      return String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id));
    });
    losers.push(...rows.slice(1));
  }

  console.log(`live checks=${all.length} duplicate groups=${[...groups.values()].filter((r) => r.length > 1).length} losers=${losers.length}`);
  if (dryRun || !losers.length) {
    if (losers.length) console.log("dry-run ids", losers.map((r) => r.id).slice(0, 20));
    return;
  }

  for (const row of losers) {
    await rpmChecksRepo.softDeleteCheck(row.id, { actor: "cleanup:member-day-dups" });
    console.log("soft-deleted", row.id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
