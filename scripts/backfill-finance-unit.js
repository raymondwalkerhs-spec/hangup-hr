/**
 * Script to backfill unit column for finance tables.
 * Restores existing costs/receipts/petty cash to Main Hangup (HS-1).
 * HS2 will have its own separate records going forward.
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

async function main() {
  const db = getSupabaseAdmin();
  
  console.log("Backfilling unit column for finance tables to Main Hangup (HS-1)...\n");
  
  const DEFAULT_UNIT = "HS-1"; // Main Hangup
  
  // 1. Expense requests - backfill from employee if possible, otherwise default to HS-1
  console.log("1. expense_requests...");
  const { data: expensesWithoutUnit, error: expErr } = await db
    .from("expense_requests")
    .select("id, employee_id")
    .is("unit", null);
  
  if (expErr) {
    console.log("  Error:", expErr.message);
  } else if (expensesWithoutUnit?.length) {
    // Try to get unit from employee
    const empIds = [...new Set(expensesWithoutUnit.map(e => e.employee_id).filter(Boolean))];
    const empUnits = new Map();
    if (empIds.length) {
      const { data: emps } = await db.from("employees").select("id, unit").in("id", empIds);
      for (const emp of emps || []) {
        empUnits.set(emp.id, emp.unit);
      }
    }
    
    let updated = 0;
    for (const exp of expensesWithoutUnit) {
      const unit = empUnits.get(exp.employee_id) || DEFAULT_UNIT;
      const { error } = await db.from("expense_requests").update({ unit }).eq("id", exp.id);
      if (!error) updated++;
    }
    console.log(`  Updated ${updated}/${expensesWithoutUnit.length} expense requests to unit: ${DEFAULT_UNIT} or employee's unit`);
  } else {
    console.log("  All expense requests already have unit set");
  }
  
  // 2. Monthly bills - default to HS-1
  console.log("\n2. monthly_bills...");
  const { data: billsWithoutUnit, error: billErr } = await db
    .from("monthly_bills")
    .select("id")
    .is("unit", null);
  
  if (billErr) {
    console.log("  Error:", billErr.message);
  } else if (billsWithoutUnit?.length) {
    const { error } = await db
      .from("monthly_bills")
      .update({ unit: DEFAULT_UNIT })
      .is("unit", null);
    if (error) {
      console.log("  Error updating:", error.message);
    } else {
      console.log(`  Updated ${billsWithoutUnit.length} monthly bills to unit: ${DEFAULT_UNIT}`);
    }
  } else {
    console.log("  All monthly bills already have unit set");
  }
  
  // 3. Petty cash funds - default to HS-1
  console.log("\n3. petty_cash_funds...");
  const { data: fundsWithoutUnit, error: fundErr } = await db
    .from("petty_cash_funds")
    .select("id")
    .is("unit", null);
  
  if (fundErr) {
    console.log("  Error:", fundErr.message);
  } else if (fundsWithoutUnit?.length) {
    const { error } = await db
      .from("petty_cash_funds")
      .update({ unit: DEFAULT_UNIT })
      .is("unit", null);
    if (error) {
      console.log("  Error updating:", error.message);
    } else {
      console.log(`  Updated ${fundsWithoutUnit.length} petty cash funds to unit: ${DEFAULT_UNIT}`);
    }
  } else {
    console.log("  All petty cash funds already have unit set");
  }
  
  // 4. Petty cash ledger - default to HS-1
  console.log("\n4. petty_cash_ledger...");
  const { data: ledgerWithoutUnit, error: ledErr } = await db
    .from("petty_cash_ledger")
    .select("id")
    .is("unit", null);
  
  if (ledErr) {
    console.log("  Error:", ledErr.message);
  } else if (ledgerWithoutUnit?.length) {
    const { error } = await db
      .from("petty_cash_ledger")
      .update({ unit: DEFAULT_UNIT })
      .is("unit", null);
    if (error) {
      console.log("  Error updating:", error.message);
    } else {
      console.log(`  Updated ${ledgerWithoutUnit.length} petty cash ledger entries to unit: ${DEFAULT_UNIT}`);
    }
  } else {
    console.log("  All petty cash ledger entries already have unit set");
  }
  
  console.log("\nDone! All existing finance records are now assigned to Main Hangup (HS-1).");
  console.log("HS2 can now create its own petty cash funds and receipts separately.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
