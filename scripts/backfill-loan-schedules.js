/**
 * Backfill loan_schedule_lines from loan_payments + remaining balance.
 * Skips loans that already have schedule rows unless --force.
 *
 * Run (against live Supabase via store sync):
 *   node scripts/backfill-loan-schedules.js
 *   node scripts/backfill-loan-schedules.js --force
 *   node scripts/backfill-loan-schedules.js --loan=L-123
 *   node scripts/backfill-loan-schedules.js --dry-run
 */
require("dotenv").config();

const {
  backfillScheduleFromLoan,
  remainingLoanAmount,
} = require("../lib/loans");

function parseArgs(argv) {
  const opts = { force: false, dryRun: false, loanId: null };
  for (const a of argv) {
    if (a === "--force") opts.force = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--loan=")) opts.loanId = a.slice("--loan=".length);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const store = require("../lib/data-store");
  await store.syncFromSheet();

  const loans = opts.loanId
    ? store.getEmployeeLoans().filter((l) => l.id === opts.loanId)
    : store.getEmployeeLoans();

  if (!loans.length) {
    console.log("No loans found.");
    return;
  }

  console.log(
    `Backfilling schedules for ${loans.length} loan(s)${opts.force ? " (force)" : ""}${
      opts.dryRun ? " [dry-run]" : ""
    }…`
  );

  if (opts.dryRun) {
    const cache = require("../lib/cache");
    let wouldWrite = 0;
    for (const loan of loans) {
      const existing = cache.getLoanScheduleLinesForLoan(loan.id);
      if (existing.length && !opts.force) {
        console.log(`  skip ${loan.id} — already has ${existing.length} line(s)`);
        continue;
      }
      const payments = cache.getAllLoanPayments().filter((p) => p.loanId === loan.id);
      const lines = backfillScheduleFromLoan(loan, payments);
      const rem = remainingLoanAmount(loan, payments);
      console.log(
        `  would write ${loan.id}: ${lines.length} line(s), remaining=${rem}, payments=${payments.length}`
      );
      wouldWrite += 1;
    }
    console.log(`Dry-run done. Would update ${wouldWrite} loan(s).`);
    return;
  }

  const results = await store.backfillLoanSchedules({
    loanId: opts.loanId || undefined,
    force: opts.force,
  });

  let written = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.skipped) {
      skipped += 1;
      console.log(`  skip ${r.loanId} — ${r.reason}`);
    } else {
      written += 1;
      console.log(`  wrote ${r.loanId}: ${r.count} line(s)`);
    }
  }
  console.log(`Done. wrote=${written} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
