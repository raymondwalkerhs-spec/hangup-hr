/**
 * CRUD for rpm_team_week_targets (Dashboard weekly team targets).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function isTableMissing(err) {
  return /does not exist|schema cache|Could not find the table/i.test(String(err?.message || err || ""));
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    company: r.company || "hangup",
    unit: r.unit || "",
    team: r.team || "",
    weekStart: r.week_start,
    targetCount: Number(r.target_count) || 0,
    updatedBy: r.updated_by || null,
    updatedAt: r.updated_at || null,
  };
}

function assertMonday(weekStart) {
  const s = String(weekStart || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("weekStart must be YYYY-MM-DD");
  const d = new Date(`${s}T12:00:00`);
  if (d.getDay() !== 1) throw new Error("weekStart must be a Monday");
  return s;
}

async function listTargets({ company, fromWeek, toWeek, unit } = {}) {
  requireSupabase();
  let q = db().from("rpm_team_week_targets").select("*");
  if (company) q = q.eq("company", company);
  if (fromWeek) q = q.gte("week_start", fromWeek);
  if (toWeek) q = q.lte("week_start", toWeek);
  if (unit) q = q.eq("unit", unit);
  const { data, error } = await q;
  if (error) {
    if (isTableMissing(error)) return { targets: [], available: false };
    throw new Error(error.message);
  }
  return { targets: (data || []).map(mapRow), available: true };
}

async function upsertTarget({ company, unit, team, weekStart, targetCount, updatedBy }) {
  requireSupabase();
  const monday = assertMonday(weekStart);
  const count = Number(targetCount);
  if (!Number.isFinite(count) || count < 1 || !Number.isInteger(count)) {
    throw new Error("targetCount must be an integer >= 1");
  }
  const teamName = String(team || "").trim();
  if (!teamName) throw new Error("team required");
  const row = {
    company: company || "hangup",
    unit: String(unit || "").trim(),
    team: teamName,
    week_start: monday,
    target_count: count,
    updated_by: updatedBy || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("rpm_team_week_targets")
    .upsert(row, { onConflict: "company,unit,team,week_start" })
    .select()
    .single();
  if (error) {
    if (isTableMissing(error)) {
      const err = new Error("Targets table missing — run migration 20260828_rpm_team_week_targets");
      err.code = "TARGETS_UNAVAILABLE";
      throw err;
    }
    throw new Error(error.message);
  }
  return mapRow(data);
}

async function deleteTarget({ company, unit, team, weekStart }) {
  requireSupabase();
  const monday = assertMonday(weekStart);
  const { error } = await db()
    .from("rpm_team_week_targets")
    .delete()
    .eq("company", company || "hangup")
    .eq("unit", String(unit || "").trim())
    .eq("team", String(team || "").trim())
    .eq("week_start", monday);
  if (error) {
    if (isTableMissing(error)) {
      const err = new Error("Targets table missing — run migration 20260828_rpm_team_week_targets");
      err.code = "TARGETS_UNAVAILABLE";
      throw err;
    }
    throw new Error(error.message);
  }
  return { ok: true };
}

module.exports = {
  listTargets,
  upsertTarget,
  deleteTarget,
  assertMonday,
  isTableMissing,
};
