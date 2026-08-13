/**
 * Backfill employee_id on existing expense_requests.
 *
 * Historical receipts were created before employee_id was stored on insert, so the
 * company-scoped GET /api/expenses filter (which matches on employee_id OR submitted_by)
 * dropped them because employee_id was NULL. This derives employee_id from the submitting
 * app user's linked employee record in app_users, keeping the expense under its correct
 * company scope.
 *
 * Run: node scripts/backfill-expense-employee-id.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();

  console.log("Backfilling employee_id on expense_requests...\n");

  // Build username -> employee_id map straight from the authoritative app_users table.
  const { data: appUsers, error: auErr } = await db
    .from("app_users")
    .select("username, employee_id");
  if (auErr) {
    console.error("Error loading app_users:", auErr.message);
    process.exit(1);
  }
  const linkMap = new Map();
  for (const u of appUsers || []) {
    if (u.employee_id) linkMap.set(String(u.username || "").toLowerCase(), u.employee_id);
  }
  console.log(`Loaded ${linkMap.size} app-user -> employee links.`);

  const { data: expenses, error } = await db
    .from("expense_requests")
    .select("id, submitted_by, employee_id")
    .is("employee_id", null);

  if (error) {
    console.error("Error fetching expenses:", error.message);
    process.exit(1);
  }
  if (!expenses?.length) {
    console.log("All expense requests already have employee_id set.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const exp of expenses) {
    const employeeId = linkMap.get(String(exp.submitted_by || "").toLowerCase()) || exp.submitted_by;
    const { error: updErr } = await db
      .from("expense_requests")
      .update({ employee_id: employeeId })
      .eq("id", exp.id);
    if (updErr) {
      console.error(`  Failed ${exp.id}:`, updErr.message);
      skipped++;
    } else {
      updated++;
    }
  }

  console.log(`\nDone. Updated ${updated}/${expenses.length} expense requests (${skipped} failed).`);
  console.log("New submissions store employee_id automatically via createExpenseRequest.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
