/**
 * Persist inferred categories for expense_requests still marked "other".
 * Usage: node scripts/backfill-expense-categories.js [--dry-run]
 */
require("dotenv").config();
const { getSupabaseAdmin, isSupabaseConfigured } = require("../lib/supabase-client");
const { inferExpenseCategory } = require("../lib/expense-category");

const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured");
  const db = getSupabaseAdmin();
  let { data, error } = await db
    .from("expense_requests")
    .select("id, description, vendor_name, category")
    .or("category.is.null,category.eq.other,category.eq.others");
  if (error && /category/i.test(error.message)) {
    console.error(
      "expense_requests.category column missing. Apply supabase/migrations/20260801_v220_expense_category.sql first."
    );
    process.exit(2);
  }
  if (error) throw new Error(error.message);

  let updated = 0;
  let skipped = 0;
  for (const row of data || []) {
    const next = inferExpenseCategory(row.description, row.vendor_name, "other");
    if (next === "other") {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] ${row.id}: ${row.description} -> ${next}`);
      updated += 1;
      continue;
    }
    const { error: updErr } = await db
      .from("expense_requests")
      .update({ category: next, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (updErr) throw new Error(updErr.message);
    updated += 1;
  }
  console.log(JSON.stringify({ dryRun, updated, skipped, scanned: (data || []).length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
