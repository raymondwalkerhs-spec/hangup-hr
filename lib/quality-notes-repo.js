/**
 * Quality notes on agents (separate from HR employee_warnings).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function mapRow(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    authorUsername: r.author_username,
    authorRole: r.author_role || "",
    body: r.body || "",
    noteDate: r.note_date,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function listForEmployee(employeeId) {
  if (!useSupabase()) return [];
  const { data, error } = await db()
    .from("employee_quality_notes")
    .select("*")
    .eq("employee_id", employeeId)
    .order("note_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapRow);
}

async function getById(id) {
  if (!useSupabase()) return null;
  const { data, error } = await db().from("employee_quality_notes").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data) : null;
}

async function createNote({ employeeId, authorUsername, authorRole, body, noteDate }, actor) {
  if (!useSupabase()) throw new Error("Quality notes require Supabase");
  const row = {
    employee_id: employeeId,
    author_username: String(authorUsername || actor || "").trim().toLowerCase(),
    author_role: authorRole || "",
    body: String(body || "").trim(),
    note_date: noteDate || new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  };
  if (!row.body) throw new Error("Note body is required");
  const { data, error } = await db().from("employee_quality_notes").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

async function updateNote(id, patch, actor) {
  if (!useSupabase()) throw new Error("Quality notes require Supabase");
  const row = { updated_at: new Date().toISOString() };
  if (patch.body !== undefined) row.body = String(patch.body || "").trim();
  if (patch.noteDate !== undefined) row.note_date = patch.noteDate;
  const { data, error } = await db().from("employee_quality_notes").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

async function deleteNote(id) {
  if (!useSupabase()) throw new Error("Quality notes require Supabase");
  const { error } = await db().from("employee_quality_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

module.exports = {
  listForEmployee,
  getById,
  createNote,
  updateNote,
  deleteNote,
};
