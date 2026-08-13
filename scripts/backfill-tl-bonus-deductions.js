/**
 * Create missing TL/OP deductions for bonuses that have (deducted from X) in reason.
 *
 *   node scripts/backfill-tl-bonus-deductions.js --dry-run
 *   node scripts/backfill-tl-bonus-deductions.js
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { parseTlBonusSourceFromReason } = require("../lib/tl-bonus-link");
const { formatTlDeductionReason } = require("../lib/tl-bonus-link");
const { TL_BONUS_TYPE } = require("../lib/hr-constants");
const { resolveTlPayerEmployeeId } = require("../lib/tl-bonus-transfer");

const DRY_RUN = process.argv.includes("--dry-run");

function hasPairedDeduction(bonus, deductions) {
  const payer = parseTlBonusSourceFromReason(bonus.reason);
  return deductions.some((d) => {
    if (d.type !== TL_BONUS_TYPE) return false;
    if (String(d.date).slice(0, 10) !== String(bonus.date).slice(0, 10)) return false;
    if (Number(d.amount) !== Number(bonus.amount)) return false;
    if (payer) return d.employee_id === payer;
    return String(d.reason || "").includes(bonus.employee_id);
  });
}

async function main() {
  const db = getSupabaseAdmin();
  const { data: bonuses, error } = await db.from("bonus_events").select("*").eq("type", TL_BONUS_TYPE);
  if (error) throw error;
  const { data: deductions } = await db.from("deduction_events").select("*").eq("type", TL_BONUS_TYPE);

  let fixed = 0;
  let skipped = 0;

  for (const bonus of bonuses || []) {
    if (hasPairedDeduction(bonus, deductions || [])) continue;

    let payer = parseTlBonusSourceFromReason(bonus.reason);
    if (!payer) {
      const { data: req } = await db
        .from("bonus_requests")
        .select("submitted_by")
        .eq("employee_id", bonus.employee_id)
        .eq("date", String(bonus.date).slice(0, 10))
        .eq("status", "approved")
        .order("reviewed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (req?.submitted_by) payer = await resolveTlPayerEmployeeId(req.submitted_by);
    }

    if (!payer) {
      skipped += 1;
      console.warn(`Skip ${bonus.employee_id} ${bonus.date}: cannot resolve TL payer`);
      continue;
    }

    console.log(
      `${DRY_RUN ? "[dry-run] " : ""}Deduction for ${payer}: ${bonus.amount} EGP (bonus to ${bonus.employee_id} on ${bonus.date})`
    );
    if (!DRY_RUN) {
      await db.from("deduction_events").upsert(
        {
          employee_id: payer,
          date: String(bonus.date).slice(0, 10),
          amount: Number(bonus.amount),
          type: TL_BONUS_TYPE,
          reason: formatTlDeductionReason(String(bonus.reason || "").replace(/\(deducted from[^)]+\)/i, "").trim(), bonus.employee_id),
          unit: bonus.unit || null,
          updated_by: "backfill-tl-bonus-deductions",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "employee_id,date" }
      );
      if (!parseTlBonusSourceFromReason(bonus.reason)) {
        await db
          .from("bonus_events")
          .update({
            reason: `${bonus.reason || "TL bonus"} (deducted from ${payer})`.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq("employee_id", bonus.employee_id)
          .eq("date", String(bonus.date).slice(0, 10));
      }
    }
    fixed += 1;
  }

  console.log(`\nSummary: ${fixed} deduction(s) ${DRY_RUN ? "would be " : ""}created, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
