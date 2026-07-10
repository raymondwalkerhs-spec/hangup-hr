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
  const { error } = await db().from("unit_ops").insert({ unit, employee_id: employeeId });
  if (error) throw new Error(error.message);
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
};
