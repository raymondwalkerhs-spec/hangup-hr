/**
 * Rebuild costs + petty-cash ledger from Asset/cash.xlsx (source of truth).
 *
 * - Strict Excel serial date parsing (skips Arabic note rows)
 * - Removes cash-import rows and near-duplicate prior expenses (date ±3d + amount)
 * - Rebuilds deposits from xlsx with correct dates
 * - Rebuilds petty-cash withdrawals for all paid petty_cash expenses
 * - Recalculates fund balance
 *
 * Usage: node scripts/sync-cash-xlsx.js [--dry-run] [--file=Asset/cash.xlsx]
 */
require("dotenv").config();
const path = require("path");
const XLSX = require("xlsx");
const { getSupabaseAdmin, isSupabaseConfigured } = require("../lib/supabase-client");
const { inferExpenseCategory } = require("../lib/expense-category");
const business = require("../lib/business-repo");

const dryRun = process.argv.includes("--dry-run");
const fileArg = process.argv.find((a) => a.startsWith("--file="));
const filePath = path.resolve(process.cwd(), fileArg ? fileArg.slice("--file=".length) : "Asset/cash.xlsx");

function excelDate(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseCashXlsx(file) {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const credits = [];
  const costs = [];

  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[0] || "").trim();
    const creditAmt = r[1];
    const creditDate = r[2];
    if (
      name &&
      !/^total\b/i.test(name) &&
      !/المطلوب|للتحويل|petty cash|need to be paid/i.test(name) &&
      typeof creditAmt === "number" &&
      creditAmt > 0 &&
      typeof creditDate === "number"
    ) {
      credits.push({ name, amount: round2(creditAmt), date: excelDate(creditDate), row: i + 1 });
    }

    const costDate = r[4];
    const amount = parseAmount(r[5]);
    const desc = String(r[6] || "").trim();
    // Only real Excel serial dates — skip Arabic note rows (ناقص تاريخ / مطلوب / …)
    if (typeof costDate === "number" && desc && amount != null && amount > 0) {
      const date = excelDate(costDate);
      if (date) costs.push({ date, amount, desc, row: i + 1 });
    }
  }
  return { credits, costs };
}

function parseAmount(v) {
  if (typeof v === "number" && Number.isFinite(v)) return round2(v);
  const s = String(v ?? "").trim();
  if (/^\d+(\.\d+)?$/.test(s)) return round2(Number(s));
  return null;
}

function expenseDate(e) {
  return String(e.due_date || e.paid_at || e.created_at || "").slice(0, 10);
}

async function main() {
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured");
  const db = getSupabaseAdmin();
  const { credits, costs } = parseCashXlsx(filePath);
  const creditTotal = round2(credits.reduce((s, c) => s + c.amount, 0));
  const costTotal = round2(costs.reduce((s, c) => s + c.amount, 0));
  console.log(`File: ${filePath}`);
  console.log(
    `Parsed credits=${credits.length} (total ${creditTotal}), costs=${costs.length} (total ${costTotal})${dryRun ? " [dry-run]" : ""}`
  );

  const funds = await business.getPettyCashFunds("hangup");
  const fund =
    funds.find((f) => /petty/i.test(f.fundName || "") && !/main\s*fund/i.test(f.fundName || "")) ||
    funds[0];
  if (!fund) throw new Error("No petty cash fund found");

  const { data: expenses, error: exErr } = await db.from("expense_requests").select("*");
  if (exErr) throw new Error(exErr.message);

  // Full replace: costs section must match cash.xlsx only (no leftover near-dupes).
  const expensesToDelete = (expenses || []).map((e) => ({ e, reason: "replace-all" }));

  console.log(`Fund=${fund.fundName}; delete expenses=${expensesToDelete.length}; will insert costs=${costs.length}, deposits=${credits.length}`);
  if (dryRun) {
    console.log("Credits:");
    credits.forEach((c) => console.log(`  + ${c.date} ${c.amount} ${c.name}`));
    console.log("Costs:");
    costs.forEach((c) => console.log(`  - ${c.date} ${c.amount} ${c.desc}`));
    console.log(JSON.stringify({ dryRun: true, creditTotal, costTotal, deleteExpenses: expensesToDelete.length }, null, 2));
    return;
  }

  for (const { e } of expensesToDelete) {
    try {
      await business.reversePettyCashForExpense(e.id);
    } catch {
      /* no linked withdrawal */
    }
    const { error } = await db.from("expense_requests").delete().eq("id", e.id);
    if (error) throw new Error(`delete expense: ${error.message}`);
  }

  // Wipe ledger for this fund — rebuild from xlsx deposits + paid petty-cash expenses
  const { error: wipeErr } = await db.from("petty_cash_ledger").delete().eq("fund_id", fund.id);
  if (wipeErr) throw new Error(`wipe ledger: ${wipeErr.message}`);
  await db.from("petty_cash_funds").update({ balance: 0, updated_at: new Date().toISOString() }).eq("id", fund.id);

  for (const c of credits) {
    await business.addPettyCashTransaction(
      {
        fundId: fund.id,
        transactionType: "deposit",
        amount: c.amount,
        notes: `Cash xlsx: ${c.name} (${c.date})`,
        createdAt: `${c.date}T12:00:00.000Z`,
      },
      "cash-xlsx-sync"
    );
  }

  for (const c of costs) {
    const category = inferExpenseCategory(c.desc);
    const created = await business.createExpenseRequest(
      {
        vendorName: "Cash sheet",
        description: c.desc,
        amount: c.amount,
        status: "paid",
        dueDate: c.date,
        paidAt: `${c.date}T12:00:00.000Z`,
        paymentMethod: "petty_cash",
        paidBy: "Petty cash",
        pettyCashFundId: fund.id,
        category,
        company: "hangup",
      },
      "cash-xlsx-sync"
    );
    await db
      .from("expense_requests")
      .update({
        created_at: `${c.date}T12:00:00.000Z`,
        paid_at: `${c.date}T12:00:00.000Z`,
        due_date: c.date,
        status: "paid",
        payment_method: "petty_cash",
        paid_by: "Petty cash",
        petty_cash_fund_id: fund.id,
        category,
      })
      .eq("id", created.id);
  }

  // Withdrawals for every paid petty-cash expense (xlsx + any kept others)
  const { data: paidPets } = await db
    .from("expense_requests")
    .select("*")
    .eq("status", "paid")
    .eq("payment_method", "petty_cash");

  const sorted = (paidPets || []).slice().sort((a, b) => expenseDate(a).localeCompare(expenseDate(b)));
  for (const e of sorted) {
    const day = expenseDate(e) || new Date().toISOString().slice(0, 10);
    await business.addPettyCashTransaction(
      {
        fundId: fund.id,
        transactionType: "withdrawal",
        amount: round2(e.amount),
        notes: `Paid expense ${e.vendor_name || ""}: ${e.description || ""}`.trim(),
        linkedExpenseId: e.id,
        createdAt: `${day}T15:00:00.000Z`,
      },
      "cash-xlsx-sync"
    );
  }

  await business.recalculatePettyCashFundBalances(fund.id);

  const { data: depAfter } = await db
    .from("petty_cash_ledger")
    .select("created_at, amount, notes, transaction_type")
    .eq("fund_id", fund.id)
    .order("created_at");
  const deposits = (depAfter || []).filter((l) => l.transaction_type === "deposit");
  const withdrawals = (depAfter || []).filter((l) => l.transaction_type === "withdrawal");
  const fundsAfter = await business.getPettyCashFunds("hangup");
  const bal = fundsAfter.find((f) => f.id === fund.id)?.balance;

  const { count: sheetCosts } = await db
    .from("expense_requests")
    .select("*", { count: "exact", head: true })
    .eq("submitted_by", "cash-xlsx-sync");

  console.log(
    JSON.stringify(
      {
        ok: true,
        deposits: deposits.map((d) => ({
          date: String(d.created_at).slice(0, 10),
          amount: d.amount,
          notes: d.notes,
        })),
        depositCount: deposits.length,
        depositSum: round2(deposits.reduce((s, d) => s + Number(d.amount), 0)),
        withdrawalCount: withdrawals.length,
        withdrawalSum: round2(withdrawals.reduce((s, d) => s + Number(d.amount), 0)),
        sheetCosts,
        xlsxCredits: credits.length,
        xlsxCosts: costs.length,
        xlsxCreditTotal: creditTotal,
        xlsxCostTotal: costTotal,
        fundBalance: bal,
        expectedBalance: round2(creditTotal - costTotal),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
