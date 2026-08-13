/**
 * Quick check: show expense_requests unit values
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("expense_requests").select("id, vendor_name, submitted_by, unit");
  if (error) { console.error(error.message); return; }
  console.log("Expense requests:");
  for (const r of (data || [])) {
    console.log(`  ${r.id}: ${r.vendor_name} | submitted_by=${r.submitted_by} | unit=${r.unit || "NULL"}`);
  }
  
  const { data: funds } = await db.from("petty_cash_funds").select("id, fund_name, unit");
  console.log("\nPetty cash funds:");
  for (const f of (funds || [])) {
    console.log(`  ${f.id}: ${f.fund_name} | unit=${f.unit || "NULL"}`);
  }
}

main().catch(console.error);
