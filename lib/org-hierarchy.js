/**
 * Organization hierarchy: units → teams → agents; OP/TL assignments.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const { normalizeTeamName } = require("./team-names");

const DIALING_UNITS = ["HS-1", "HS-2", "HS-3"];
const BACKEND_UNIT = "HS-Back-End";
const MGMT_UNIT = "HS-MGMT";
const HS2_COMPANY_UNIT = "HS-2";

const UNIT_RULES = {
  "HS-1": { company: "hangup", hasOp: true, label: "HS-1" },
  "HS-2": { company: "hs2", hasOp: true, label: "HS2 Company" },
  "HS-3": { company: "hangup", hasOp: true, label: "HS-3" },
  [BACKEND_UNIT]: { company: "hangup", hasOp: false, reportsTo: "CEO", label: "Back-End" },
  [MGMT_UNIT]: { company: "hangup", hasOp: false, reportsTo: "CEO", label: "Management" },
};

const BACKEND_TEAMS = new Set(["HR", "Quality", "RTM", "Finance", "Back-End", "Daemon", "Admins"]);

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function unitRule(unit) {
  return UNIT_RULES[unit] || { company: "hangup", hasOp: true, label: unit };
}

async function readUnitManagers() {
  requireSupabase();
  const { data, error } = await db().from("org_unit_managers").select("*");
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    unit: r.unit,
    company: r.company || "hangup",
    opEmployeeId: r.op_employee_id || "",
    hrManagerId: r.hr_manager_id || "",
    notes: r.notes || "",
  }));
}

async function upsertUnitManager(unit, patch, actor) {
  requireSupabase();
  const row = { unit, updated_at: new Date().toISOString() };
  if (patch.opEmployeeId !== undefined) row.op_employee_id = patch.opEmployeeId || null;
  if (patch.hrManagerId !== undefined) row.hr_manager_id = patch.hrManagerId || null;
  if (patch.company !== undefined) row.company = patch.company || "hangup";
  if (patch.notes !== undefined) row.notes = patch.notes || null;
  const { data, error } = await db().from("org_unit_managers").upsert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function assignTeamLead(teamId, tlEmployeeId) {
  requireSupabase();
  const { data, error } = await db()
    .from("org_teams")
    .update({ tl_employee_id: tlEmployeeId || null, updated_at: new Date().toISOString() })
    .eq("id", teamId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function inferOpCandidates(employees, unit) {
  return employees.filter(
    (e) =>
      e.unit === unit &&
      (/^OP/i.test(String(e.id || "")) || String(e.role || "").toLowerCase() === "op")
  );
}

function inferTlCandidates(employees, teamName) {
  const team = normalizeTeamName(teamName);
  return employees.filter((e) => {
    const t = normalizeTeamName(e.team);
    if (t !== team) return false;
    return /^TL/i.test(String(e.id || "")) || String(e.role || "").toLowerCase() === "tl";
  });
}

function inferHrManager(employees) {
  const byName = employees.find((e) => normName(e.american_name).includes("phoebe"));
  if (byName) return byName;
  return employees.find(
    (e) =>
      /^HR/i.test(String(e.id || "")) &&
      (normName(e.american_name).includes("phoebe") || String(e.role || "").toLowerCase() === "hr")
  );
}

function normName(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

module.exports = {
  DIALING_UNITS,
  BACKEND_UNIT,
  MGMT_UNIT,
  HS2_COMPANY_UNIT,
  UNIT_RULES,
  BACKEND_TEAMS,
  unitRule,
  readUnitManagers,
  upsertUnitManager,
  assignTeamLead,
  inferOpCandidates,
  inferTlCandidates,
  inferHrManager,
};
