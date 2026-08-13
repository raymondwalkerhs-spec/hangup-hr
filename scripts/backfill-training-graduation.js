/**
 * Close stale training programs and normalize Agent positions for graduated trainees.
 *
 *   node scripts/backfill-training-graduation.js --dry-run
 *   node scripts/backfill-training-graduation.js
 */
require("dotenv").config();
const { syncAllTrainingGraduations } = require("../lib/training-phases");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const results = await syncAllTrainingGraduations({ dryRun: DRY_RUN, actor: "backfill-training-graduation" });
  if (!results.length) {
    console.log("No training graduation fixes needed.");
    return;
  }
  console.log(`${DRY_RUN ? "[dry-run] " : ""}Updated ${results.length} employee(s):`);
  for (const row of results) {
    console.log(
      `  ${row.employeeId}: outcome=passed promo=${row.promotion_effective_date || "?"} position=${row.position || "?"}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
