/**
 * Script to add unit column to finance tables and backfill with HS-1 (Main Hangup).
 * Uses the Management API to run ALTER TABLE statements.
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");

// Extract project ref from SUPABASE_URL
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_PROJECT_REF = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "");
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

async function runSql(sql) {
  if (!SUPABASE_PROJECT_REF || !SUPABASE_ACCESS_TOKEN) {
    throw new Error("SUPABASE_URL and SUPABASE_ACCESS_TOKEN required in .env");
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Management API ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

async function main() {
  console.log("Adding unit column to finance tables and backfilling with HS-1...\n");
  console.log(`Project: ${SUPABASE_PROJECT_REF}\n`);
  
  const DEFAULT_UNIT = "HS-1"; // Main Hangup
  
  // Tables that need unit column
  const tables = [
    "expense_requests",
    "monthly_bills",
    "petty_cash_funds",
    "petty_cash_ledger",
    "employee_loans",
    "loan_payments",
    "bonus_requests"
  ];
  
  // Add unit column to all tables
  for (const table of tables) {
    console.log(`Adding unit column to ${table}...`);
    try {
      await runSql(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS unit text;`);
      console.log(`  ✓ Column added`);
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
  }
  
  // Create indexes
  console.log("\nCreating indexes...");
  for (const table of tables) {
    try {
      await runSql(`CREATE INDEX IF NOT EXISTS idx_${table}_unit ON ${table}(unit);`);
      console.log(`  ✓ idx_${table}_unit`);
    } catch (err) {
      console.log(`  Index ${table}: ${err.message.slice(0, 100)}`);
    }
  }
  
  // Backfill expense_requests from employee unit
  console.log("\nBackfilling expense_requests from employee unit...");
  try {
    await runSql(`
      UPDATE expense_requests er
      SET unit = COALESCE(e.unit, '${DEFAULT_UNIT}')
      FROM employees e
      WHERE er.submitted_by = e.id AND er.unit IS NULL;
    `);
    // Set remaining to default
    await runSql(`UPDATE expense_requests SET unit = '${DEFAULT_UNIT}' WHERE unit IS NULL;`);
    console.log("  ✓ expense_requests backfilled");
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }
  
  // Backfill employee_loans from employee unit
  console.log("Backfilling employee_loans from employee unit...");
  try {
    await runSql(`
      UPDATE employee_loans el
      SET unit = COALESCE(e.unit, '${DEFAULT_UNIT}')
      FROM employees e
      WHERE el.employee_id = e.id AND el.unit IS NULL;
    `);
    await runSql(`UPDATE employee_loans SET unit = '${DEFAULT_UNIT}' WHERE unit IS NULL;`);
    console.log("  ✓ employee_loans backfilled");
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }
  
  // Backfill loan_payments from employee unit
  console.log("Backfilling loan_payments from employee unit...");
  try {
    await runSql(`
      UPDATE loan_payments lp
      SET unit = COALESCE(e.unit, '${DEFAULT_UNIT}')
      FROM employees e
      WHERE lp.employee_id = e.id AND lp.unit IS NULL;
    `);
    await runSql(`UPDATE loan_payments SET unit = '${DEFAULT_UNIT}' WHERE unit IS NULL;`);
    console.log("  ✓ loan_payments backfilled");
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }
  
  // Backfill monthly_bills to default
  console.log("Backfilling monthly_bills...");
  try {
    await runSql(`UPDATE monthly_bills SET unit = '${DEFAULT_UNIT}' WHERE unit IS NULL;`);
    console.log("  ✓ monthly_bills backfilled");
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }
  
  // Backfill petty_cash_funds to default
  console.log("Backfilling petty_cash_funds...");
  try {
    await runSql(`UPDATE petty_cash_funds SET unit = '${DEFAULT_UNIT}' WHERE unit IS NULL;`);
    console.log("  ✓ petty_cash_funds backfilled");
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }
  
  // Backfill petty_cash_ledger to default
  console.log("Backfilling petty_cash_ledger...");
  try {
    await runSql(`UPDATE petty_cash_ledger SET unit = '${DEFAULT_UNIT}' WHERE unit IS NULL;`);
    console.log("  ✓ petty_cash_ledger backfilled");
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }
  
  // Backfill bonus_requests to default
  console.log("Backfilling bonus_requests...");
  try {
    await runSql(`UPDATE bonus_requests SET unit = '${DEFAULT_UNIT}' WHERE unit IS NULL;`);
    console.log("  ✓ bonus_requests backfilled");
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }
  
  console.log("\nDone! All existing finance records are now assigned to Main Hangup (HS-1) or employee's unit.");
  console.log("HS2 can now create its own petty cash funds and receipts separately.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
