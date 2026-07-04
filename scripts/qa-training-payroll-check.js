#!/usr/bin/env node
/** Automated checks for training payroll QA checklist section. */
require("dotenv").config();

async function main() {
  const checks = [];
  const pass = (name) => checks.push({ name, ok: true });
  const fail = (name, err) => checks.push({ name, ok: false, err: String(err) });

  try {
    require("../lib/training-pay-rules");
    require("../lib/training-payroll");
    require("../lib/resignation-payroll");
    pass("training modules load");
  } catch (e) {
    fail("training modules load", e.message);
  }

  const { getSupabaseAdmin } = require("../lib/supabase-client");
  const db = getSupabaseAdmin();

  const trainee = await db.from("position_rates").select("monthly_salary").eq("position", "Trainee").maybeSingle();
  if (trainee.error) fail("Trainee position_rates row", trainee.error.message);
  else if (!trainee.data?.monthly_salary || trainee.data.monthly_salary <= 0) {
    fail("Trainee monthly rate set", "Trainee salary is 0 or missing");
  } else pass(`Trainee rate = ${trainee.data.monthly_salary} EGP`);

  const ym = new Date().toISOString().slice(0, 7);
  const monthly = await db
    .from("position_rate_monthly")
    .select("monthly_salary")
    .eq("position", "Trainee")
    .eq("year_month", ym)
    .maybeSingle();
  if (monthly.error) fail("Trainee position_rate_monthly", monthly.error.message);
  else if (!monthly.data?.monthly_salary) fail("Trainee month rate", `missing for ${ym}`);
  else pass(`Trainee month rate ${ym} = ${monthly.data.monthly_salary}`);

  const outcome = await db.from("agent_training_programs").select("outcome").limit(1);
  if (outcome.error) fail("training_payroll migration", outcome.error.message);
  else pass("agent_training_programs.outcome column exists");

  const perms = require("../lib/permission-catalog").listPermissions().map((p) => p.key);
  for (const k of [
    "manageTrainingProgram",
    "viewTrainingPayPreview",
    "approveTrainingPayslip",
    "manageResignationPayRules",
  ]) {
    if (!perms.includes(k)) fail(`permission ${k}`, "missing from catalog");
    else pass(`permission ${k}`);
  }

  const roles = require("../lib/roles");
  for (const fn of [
    "canManageTrainingProgram",
    "canViewTrainingPayPreview",
    "canApproveTrainingPayslip",
    "canManageResignationPayRules",
  ]) {
    if (typeof roles[fn] !== "function") fail(`roles.${fn}`, "missing");
    else pass(`roles.${fn}`);
  }

  const { execSync } = require("child_process");
  execSync("node scripts/test-training-payroll.js", { stdio: "pipe" });
  pass("npm run test:training-payroll");

  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(c.ok ? `  PASS  ${c.name}` : `  FAIL  ${c.name}: ${c.err}`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} training payroll QA checks passed.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
