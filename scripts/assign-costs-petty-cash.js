/**
 * Assign all existing expense_requests as paid by Petty cash.
 * Does NOT create ledger withdrawals (assignment only — avoids double-counting history).
 *
 * Usage: node scripts/assign-costs-petty-cash.js [--dry-run]
 */
require("dotenv").config();
const { getSupabaseAdmin, isSupabaseConfigured } = require("../lib/supabase-client");

const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured");
  const db = getSupabaseAdmin();

  let fundId = null;
  const { data: funds, error: fErr } = await db.from("petty_cash_funds").select("id, fund_name").order("fund_name");
  if (fErr) throw new Error(fErr.message);
  const petty =
    (funds || []).find((f) => /petty/i.test(f.fund_name || "")) ||
    (funds || []).find((f) => !/main\s*fund/i.test(f.fund_name || "")) ||
    (funds || [])[0];
  fundId = petty?.id || null;

  // Ensure a Main Fund row exists for future assignment (no balance sync required)
  const hasMain = (funds || []).some((f) => /main\s*fund/i.test(f.fund_name || ""));
  if (!hasMain && !dryRun) {
    const { error: insErr } = await db.from("petty_cash_funds").insert({
      fund_name: "Main Fund",
      balance: 0,
      company: "hangup",
      updated_at: new Date().toISOString(),
    });
    if (insErr) console.warn("Could not create Main Fund:", insErr.message);
    else console.log("Created fund: Main Fund");
  }

  const { data: rows, error } = await db
    .from("expense_requests")
    .select("id, payment_method, paid_by, petty_cash_fund_id, status");
  if (error) throw new Error(error.message);

  const toUpdate = (rows || []).filter(
    (r) =>
      r.status !== "paid" ||
      r.payment_method !== "petty_cash" ||
      r.paid_by !== "Petty cash" ||
      (fundId && r.petty_cash_fund_id !== fundId) ||
      !r.paid_at
  );

  console.log(`Expenses total=${(rows || []).length}, to reassign=${toUpdate.length}, fund=${petty?.fund_name || "(none)"}`);

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, wouldUpdate: toUpdate.length, fundId }, null, 2));
    return;
  }

  let updated = 0;
  for (const r of toUpdate) {
    const patch = {
      status: "paid",
      payment_method: "petty_cash",
      paid_by: "Petty cash",
      settlement_status: null,
      updated_at: new Date().toISOString(),
      paid_at: r.paid_at || new Date().toISOString(),
    };
    if (fundId) patch.petty_cash_fund_id = fundId;
    const { error: updErr } = await db.from("expense_requests").update(patch).eq("id", r.id);
    if (updErr) throw new Error(updErr.message);
    updated += 1;
  }

  console.log(JSON.stringify({ updated, fundId, fundName: petty?.fund_name || null }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
