const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

async function readTeamClosers(teamId) {
  requireSupabase();
  const { data, error } = await db()
    .from("team_closers")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.employee_id);
}

async function readAllTeamClosers() {
  requireSupabase();
  const { data, error } = await db().from("team_closers").select("*").order("created_at");
  if (error) throw new Error(error.message);
  const byTeam = {};
  for (const r of data || []) {
    if (!byTeam[r.team_id]) byTeam[r.team_id] = [];
    byTeam[r.team_id].push(r.employee_id);
  }
  return byTeam;
}

async function addTeamCloser(teamId, employeeId) {
  requireSupabase();
  const { error } = await db().from("team_closers").insert({ team_id: teamId, employee_id: employeeId });
  if (error) throw new Error(error.message);
}

async function removeTeamCloser(teamId, employeeId) {
  requireSupabase();
  const { error } = await db()
    .from("team_closers")
    .delete()
    .eq("team_id", teamId)
    .eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
}

module.exports = {
  readTeamClosers,
  readAllTeamClosers,
  addTeamCloser,
  removeTeamCloser,
};
