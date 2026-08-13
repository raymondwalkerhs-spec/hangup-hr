#!/usr/bin/env node
/**
 * Live probe: MLA/RPM program split, catalogs, submit-scope, storage (Supabase + lib).
 * Usage: node scripts/probe-sales-program-live.js
 */
require("dotenv").config();
const salesClients = require("../lib/sales-clients-repo");
const saleProgramAccess = require("../lib/sale-program-access");
const saleSubmitScope = require("../lib/sale-submit-scope");
const programStorage = require("../lib/sale-program-storage");
const rpmActions = require("../lib/sales-rpm-action-permissions");
const hrmsRepo = require("../lib/hrms-repo");
const companyContext = require("../lib/company-context");
const { BACKUP_TABLES } = require("../lib/backup-tables");
const { getSupabaseAdmin } = require("../lib/supabase-client");
const { mapEmployeeRow } = require("../lib/entity-mappers");

function ok(msg) {
  console.log("  OK", msg);
}
function fail(msg) {
  console.error("  FAIL", msg);
  process.exitCode = 1;
}

async function loadEmployeesFromSupabase() {
  const db = getSupabaseAdmin();
  const rows = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await db.from("employees").select("*").range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const batch = data || [];
    rows.push(...batch.map(mapEmployeeRow));
    if (batch.length < page) break;
    from += page;
  }
  return rows;
}

async function main() {
  console.log("=== Live sales program probe ===\n");

  const employees = await loadEmployeesFromSupabase();
  const orgTeams = await hrmsRepo.readOrgTeams();
  ok(`employees loaded from Supabase: ${employees.length}`);

  const rpmClients = await salesClients.readSalesClientsCatalog("hangup", { saleProgram: "rpm" });
  const mlaClients = await salesClients.readSalesClientsCatalog("hangup", { saleProgram: "mla" });
  const rpmActive = await salesClients.catalogHasActiveProducts("hangup", { saleProgram: "rpm" });
  const rpmClientsActive = await salesClients.catalogHasActiveClients("hangup", { saleProgram: "rpm" });
  const mlaActive = await salesClients.catalogHasActiveProducts("hangup", { saleProgram: "mla" });

  console.log("\n-- Catalogs (hangup) --");
  console.log(`  MLA clients: ${mlaClients.length} (active products: ${mlaActive})`);
  rpmClients.forEach((c) => {
    console.log(`    RPM client: ${c.name} status=${c.status} products=${(c.products || []).length}`);
  });
  if (rpmClients.length >= 2) ok(`RPM has ${rpmClients.length} clients`);
  else fail(`expected >= 2 RPM clients, got ${rpmClients.length}`);
  if (rpmActive) ok("RPM catalogHasActiveProducts = true (client-based)");
  else fail(`RPM catalogHasActiveProducts = ${rpmActive}`);
  if (rpmClientsActive) ok("RPM catalogHasActiveClients = true");
  else fail("RPM catalogHasActiveClients = false");

  const mlaNames = mlaClients.map((c) => String(c.name).toLowerCase());
  if (!mlaNames.includes("rpm1") && !mlaNames.includes("rpm2")) ok("MLA catalog excludes RPM1/RPM2");
  else fail("MLA catalog contains RPM client names");

  console.log("\n-- Submit scope (simulated roles) --");
  const scoped = companyContext.filterEmployeesByCompany(employees, "hangup");
  const adminScope = saleSubmitScope.buildSubmitScopePayload(
    { role: "admin", employeeId: "HR-01", unit: "HS-MGMT" },
    employees,
    orgTeams,
    { program: "mla", company: "hangup" }
  );
  if (!adminScope.lockUnit) ok("Admin MLA lockUnit=false");
  else fail("Admin MLA lockUnit should be false");
  if (adminScope.agents.length > 0) ok(`Admin MLA agents: ${adminScope.agents.length}`);
  else fail("Admin MLA agents list empty");
  if (adminScope.closers.length > 0) ok(`Admin MLA closers: ${adminScope.closers.length}`);
  else fail("Admin MLA closers list empty");

  const qualityScope = saleSubmitScope.buildSubmitScopePayload(
    { role: "quality", employeeId: "QA-01", unit: "Quality" },
    employees,
    orgTeams,
    { program: "rpm", company: "hangup" }
  );
  if (qualityScope.agents.length > 0 && qualityScope.closers.length > 0) {
    ok(`Quality RPM scope agents=${qualityScope.agents.length} closers=${qualityScope.closers.length}`);
  } else fail("Quality RPM scope empty");

  const sampleId = scoped.find((e) => /^HS1-/i.test(String(e.id)) && String(e.status).toLowerCase() === "active")?.id;
  const plainAgent = {
    role: "agent",
    employeeId: sampleId || "HS1-10",
    unit: "HS-1",
    team: "Phoenix",
    leadTeams: [],
  };
  const plainAgents = saleSubmitScope.employeesForAgentPicker(plainAgent, scoped, { program: "rpm" });
  if (plainAgents.length === 1) ok("Plain agent picker = self only");
  else fail(`Plain agent picker expected 1, got ${plainAgents.length}`);

  console.log("\n-- RPM action permissions --");
  await rpmActions.loadMap();
  for (const role of ["quality", "rtm", "admin", "agent"]) {
    const can = rpmActions.canPerformActionSync("submit_sale", role);
    console.log(`  submit_sale ${role}: ${can}`);
    if (role === "quality" || role === "rtm") {
      if (can) ok(`${role} can submit RPM`);
      else fail(`${role} cannot submit RPM`);
    }
  }

  console.log("\n-- Storage & backup tables --");
  for (const t of ["rpm_sales", "rpm_sales_attachments", "sales", "sales_attachments"]) {
    if (BACKUP_TABLES.includes(t)) ok(`backup includes ${t}`);
    else fail(`backup missing ${t}`);
  }
  ok(`MLA quality path: ${programStorage.qualityRecordFolder("mla", "test-id")}`);
  ok(`RPM quality path: ${programStorage.qualityRecordFolder("rpm", "test-id")}`);

  console.log("\n-- Employee flags (sample) --");
  const dialer = employees.find(
    (e) => e.sales_rpm_enabled && !e.sales_mla_enabled && String(e.status).toLowerCase() === "active"
  );
  const leader = employees.find(
    (e) => e.sales_mla_enabled && e.sales_rpm_enabled && /^(TL|CL|OP)/i.test(String(e.id))
  );
  if (dialer) ok(`Dialer sample ${dialer.id}: programs=${saleProgramAccess.employeePrograms(dialer).join(",")}`);
  if (leader) ok(`Leader sample ${leader.id}: programs=${saleProgramAccess.employeePrograms(leader).join(",")}`);

  console.log("\n=== Probe complete ===");
  if (process.exitCode) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
