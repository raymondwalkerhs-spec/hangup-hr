/**
 * Team Dashboard per-agent per-day notes.
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
  return /does not exist|schema cache|Could not find the table/i.test(
    String(err?.message || err || "")
  );
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    company: r.company || "hangup",
    agentId: r.agent_id,
    workingDay: r.working_day,
    note: r.note || "",
    updatedBy: r.updated_by || null,
    updatedAt: r.updated_at || null,
  };
}

async function listNotes({ company, workingDay, agentIds } = {}) {
  requireSupabase();
  let q = db().from("team_dashboard_agent_notes").select("*");
  if (company) q = q.eq("company", company);
  if (workingDay) q = q.eq("working_day", workingDay);
  if (agentIds?.length) q = q.in("agent_id", agentIds);
  const { data, error } = await q;
  if (error) {
    if (isTableMissing(error)) return { notes: [], available: false };
    throw new Error(error.message);
  }
  return { notes: (data || []).map(mapRow), available: true };
}

async function upsertNote({ company, agentId, workingDay, note, updatedBy }) {
  requireSupabase();
  const aid = String(agentId || "").trim();
  const day = String(workingDay || "").slice(0, 10);
  if (!aid || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("agentId and workingDay required");
  }
  const row = {
    company: company || "hangup",
    agent_id: aid,
    working_day: day,
    note: String(note || "").trim(),
    updated_by: updatedBy || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("team_dashboard_agent_notes")
    .upsert(row, { onConflict: "company,agent_id,working_day" })
    .select()
    .single();
  if (error) {
    if (isTableMissing(error)) {
      const err = new Error("team_dashboard_agent_notes table not available");
      err.code = "TABLE_MISSING";
      throw err;
    }
    throw new Error(error.message);
  }
  return mapRow(data);
}

module.exports = {
  listNotes,
  upsertNote,
  isTableMissing,
};
