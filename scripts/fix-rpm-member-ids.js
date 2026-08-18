/**
 * Apply Quality/HR-provided Member IDs from CSV: id,memberId
 * Does not invent IDs. Rejects rows that still fail the helper.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { validateMemberId, stripMemberId } = require("../lib/rpm-member-id");

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/fix-rpm-member-ids.js <csv>");
    process.exit(1);
  }
  const raw = fs.readFileSync(path.resolve(file), "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const db = getSupabaseAdmin();
  let ok = 0;
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const [id, memberId] = line.split(",").map((s) => String(s || "").trim());
    const check = validateMemberId(memberId);
    if (!id || !check.ok) {
      skipped += 1;
      console.error("skip", id, check.message || "missing id");
      continue;
    }
    const { error } = await db
      .from("rpm_sales")
      .update({ member_id: stripMemberId(memberId) })
      .eq("id", id);
    if (error) {
      skipped += 1;
      console.error("fail", id, error.message);
      continue;
    }
    ok += 1;
  }
  console.log(JSON.stringify({ updated: ok, skipped }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
