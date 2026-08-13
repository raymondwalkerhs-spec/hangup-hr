/**
 * Script to check which finance tables exist and add unit column if missing.
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  
  const tables = [
    "expense_requests",
    "monthly_bills", 
    "petty_cash_funds",
    "petty_cash_ledger",
    "employee_loans",
    "loan_payments",
    "bonus_events",
    "deduction_events",
    "bonus_requests"
  ];
  
  console.log("Checking finance tables...\n");
  
  for (const table of tables) {
    const { data, error } = await db.from(table).select("*").limit(1);
    if (error) {
      console.log(`${table}: ERROR - ${error.message}`);
    } else {
      console.log(`${table}: EXISTS (${data?.length || 0} rows)`);
      // Check if unit column exists
      if (data && data.length > 0) {
        const hasUnit = "unit" in data[0];
        console.log(`  - has unit column: ${hasUnit}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
