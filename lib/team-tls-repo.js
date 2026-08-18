const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

async function readTeamTls(teamId) {
  requireSupabase();
  const { data, error } = await db()
    .from("team_tls")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.employee_id);
}

async function readAllTeamTls() {
  requireSupabase();
  const { data, error } = await db().from("team_tls").select("*").order("created_at");
  if (error) throw new Error(error.message);
  const byTeam = {};
  for (const r of data || []) {
    if (!byTeam[r.team_id]) byTeam[r.team_id] = [];
    byTeam[r.team_id].push(r.employee_id);
  }
  return byTeam;
}

async function addTeamTl(teamId, employeeId) {
  requireSupabase();
  const { error } = await db().from("team_tls").insert({ team_id: teamId, employee_id: employeeId });
  if (error) throw new Error(error.message);
}

async function removeTeamTl(teamId, employeeId) {
  requireSupabase();
  const { error } = await db()
    .from("team_tls")
    .delete()
    .eq("team_id", teamId)
    .eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
}

async function readUnitOps(unit) {
  requireSupabase();
  const { data, error } = await db()
    .from("unit_ops")
    .select("*")
    .eq("unit", unit)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.employee_id);
}

async function readAllUnitOps() {
  requireSupabase();
  const { data, error } = await db().from("unit_ops").select("*").order("created_at");
  if (error) throw new Error(error.message);
  const byUnit = {};
  for (const r of data || []) {
    if (!byUnit[r.unit]) byUnit[r.unit] = [];
    byUnit[r.unit].push(r.employee_id);
  }
  return byUnit;
}

async function addUnitOp(unit, employeeId) {
  requireSupabase();
  const { error } = await db()
    .from("unit_ops")
    .upsert({ unit, employee_id: employeeId }, { onConflict: "unit,employee_id", ignoreDuplicates: true });
  if (error) {
    if (/duplicate key|unique constraint/i.test(error.message)) return { already: true };
    throw new Error(error.message);
  }
  return { already: false };
}

function mergeUnitOpsMaps(byUnit, managers = []) {
  const out = {};
  const add = (unit, id) => {
    const u = String(unit || "").trim();
    const empId = String(id || "").trim();
    if (!u || !empId) return;
    if (!out[u]) out[u] = [];
    if (!out[u].includes(empId)) out[u].push(empId);
  };
  if (Array.isArray(byUnit)) {
    for (const row of byUnit) add(row.unit, row.employee_id || row.employeeId);
  } else {
    for (const [unit, ids] of Object.entries(byUnit || {})) {
      for (const id of ids || []) add(unit, id);
    }
  }
  for (const m of managers || []) add(m.unit, m.opEmployeeId);
  return out;
}

function filterUnitOpsByCompany(byUnit, company) {
  const { getCompanyForUnit } = require("./company-context");
  const co = String(company || "hangup").trim().toLowerCase() || "hangup";
  return Object.fromEntries(
    Object.entries(byUnit || {}).filter(([unit]) => getCompanyForUnit(unit) === co)
  );
}

async function removeUnitOp(unit, employeeId) {
  requireSupabase();
  const { error } = await db()
    .from("unit_ops")
    .delete()
    .eq("unit", unit)
    .eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
}

module.exports = {
  readTeamTls,
  readAllTeamTls,
  addTeamTl,
  removeTeamTl,
  readUnitOps,
  readAllUnitOps,
  addUnitOp,
  removeUnitOp,
  mergeUnitOpsMaps,
  filterUnitOpsByCompany,
};
