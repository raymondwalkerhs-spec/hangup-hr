/**
 * Coaching tickets (agent + coach + outcome + notes).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const { COACHING_OUTCOMES } = require("./coaching-scope");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function normalizeOutcome(value) {
  const v = String(value || "pending").trim().toLowerCase();
  return COACHING_OUTCOMES.includes(v) ? v : "pending";
}

function mapRow(r, { includeSecret = false } = {}) {
  if (!r) return null;
  const out = {
    id: r.id,
    company: r.company,
    employeeId: r.employee_id,
    coachEmployeeId: r.coach_employee_id || "",
    submittedBy: r.submitted_by || r.created_by || "",
    coachingDate: r.coaching_date,
    coachingAt: r.coaching_at || null,
    outcome: normalizeOutcome(r.outcome),
    generalNotes: r.general_notes || "",
    extraGeneralNotes: r.extra_general_notes || "",
    status: r.status || "open",
    createdBy: r.created_by || "",
    authorEmployeeId: r.author_employee_id || "",
    authorRole: r.author_role || "",
    unit: r.unit || "",
    team: r.team || "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hasSecretNotes: Boolean(String(r.secret_notes || "").trim() || String(r.extra_secret_notes || "").trim()),
  };
  if (includeSecret) {
    out.secretNotes = r.secret_notes || "";
    out.extraSecretNotes = r.extra_secret_notes || "";
  }
  return out;
}

async function listCoachingTickets({ company, employeeId } = {}) {
  requireSupabase();
  let q = db().from("coaching_tickets").select("*").eq("company", company || "hangup");
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q.order("coaching_at", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

async function getCoachingTicket(id) {
  requireSupabase();
  const { data, error } = await db().from("coaching_tickets").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

function parseCoachingAt(value, fallbackDate) {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (fallbackDate) {
    const d = new Date(`${fallbackDate}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

async function createCoachingTicket(payload, actor) {
  requireSupabase();
  const employeeId = String(payload.employeeId || "").trim();
  if (!employeeId) throw new Error("Agent is required");
  const coachingAt = parseCoachingAt(payload.coachingAt, payload.coachingDate);
  const coachingDate = String(payload.coachingDate || coachingAt.slice(0, 10)).slice(0, 10);
  const row = {
    company: payload.company === "hs2" ? "hs2" : "hangup",
    employee_id: employeeId,
    coach_employee_id: String(payload.coachEmployeeId || "").trim() || null,
    submitted_by: payload.submittedBy || actor || "",
    coaching_date: coachingDate,
    coaching_at: coachingAt,
    outcome: normalizeOutcome(payload.outcome),
    general_notes: String(payload.generalNotes || "").trim(),
    secret_notes: String(payload.secretNotes || "").trim(),
    extra_general_notes: "",
    extra_secret_notes: "",
    status: payload.status === "done" ? "done" : "open",
    created_by: actor || "",
    author_employee_id: payload.authorEmployeeId || null,
    author_role: payload.authorRole || "",
    unit: payload.unit || "",
    team: payload.team || "",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("coaching_tickets").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateCoachingTicket(id, patch) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  if (patch.coachingAt !== undefined || patch.coachingDate !== undefined) {
    const coachingAt = parseCoachingAt(patch.coachingAt, patch.coachingDate);
    row.coaching_at = coachingAt;
    row.coaching_date = String(patch.coachingDate || coachingAt.slice(0, 10)).slice(0, 10);
  }
  if (patch.generalNotes !== undefined) row.general_notes = String(patch.generalNotes || "").trim();
  if (patch.secretNotes !== undefined) row.secret_notes = String(patch.secretNotes || "").trim();
  if (patch.extraGeneralNotes !== undefined) row.extra_general_notes = String(patch.extraGeneralNotes || "").trim();
  if (patch.extraSecretNotes !== undefined) row.extra_secret_notes = String(patch.extraSecretNotes || "").trim();
  if (patch.outcome !== undefined) row.outcome = normalizeOutcome(patch.outcome);
  if (patch.status !== undefined) row.status = patch.status === "done" ? "done" : "open";
  if (patch.employeeId !== undefined) row.employee_id = String(patch.employeeId || "").trim();
  if (patch.coachEmployeeId !== undefined) row.coach_employee_id = String(patch.coachEmployeeId || "").trim() || null;
  if (patch.unit !== undefined) row.unit = patch.unit || "";
  if (patch.team !== undefined) row.team = patch.team || "";
  const { data, error } = await db().from("coaching_tickets").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteCoachingTicket(id, actor) {
  requireSupabase();
  const existing = await getCoachingTicket(id);
  if (!existing) return { ok: false };
  const recycleBin = require("./recycle-bin");
  await recycleBin.archiveLiveRow({
    table: "coaching_tickets",
    id,
    company: existing.company,
    deletedBy: actor,
  });
  return { ok: true };
}

module.exports = {
  mapRow,
  listCoachingTickets,
  getCoachingTicket,
  createCoachingTicket,
  updateCoachingTicket,
  deleteCoachingTicket,
  normalizeOutcome,
};
