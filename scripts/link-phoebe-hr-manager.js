#!/usr/bin/env node
/**
 * Link Phoebe as HS-Back-End HR manager in org_unit_managers.
 */
require("dotenv").config();
const { getSupabaseAdmin } = require("../lib/supabase-client");
const orgHierarchy = require("../lib/org-hierarchy");

async function main() {
  const db = getSupabaseAdmin();
  const { data: employees } = await db.from("employees").select("id,american_name,arabic_name,unit,team,position");
  let phoebe = orgHierarchy.inferHrManager(employees || []);

  if (!phoebe) {
    const { data: users } = await db.from("app_users").select("username,employee_id,email");
    const user = (users || []).find((u) => String(u.username || "").toLowerCase() === "phoebe");
    if (user?.employee_id) {
      phoebe = (employees || []).find((e) => e.id === user.employee_id);
    }
    if (!phoebe && user) {
      const hrId = "HR-Phoebe";
      const exists = (employees || []).find((e) => e.id === hrId);
      if (!exists) {
        const row = {
          id: hrId,
          american_name: "Phoebe",
          unit: orgHierarchy.BACKEND_UNIT,
          team: "HR",
          position: "HR Manager",
          status: "Active",
          employment_date: new Date().toISOString().slice(0, 10),
        };
        const { error } = await db.from("employees").insert(require("../lib/supabase/mappers").employeeToDb(row));
        if (error) throw new Error(error.message);
        phoebe = row;
        console.log(`Created employee ${hrId}`);
        if (!user.employee_id) {
          await db.from("app_users").update({ employee_id: hrId }).eq("username", user.username);
        }
      } else {
        phoebe = exists;
      }
    }
  }

  if (!phoebe) throw new Error("Could not find or create Phoebe employee record");

  await orgHierarchy.upsertUnitManager(orgHierarchy.BACKEND_UNIT, {
    hrManagerId: phoebe.id,
    company: "hangup",
    notes: "No OP — reports to CEO · HR: Phoebe",
  });
  console.log(`Linked ${phoebe.id} (${phoebe.american_name}) as Back-End HR manager.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
