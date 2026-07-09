const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function mapRow(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description || "",
    proposedDate: r.proposed_date,
    proposedTime: r.proposed_time,
    durationMinutes: r.duration_minutes || 30,
    requesterEmployeeId: r.requester_employee_id,
    requesterRole: r.requester_role,
    participants: r.participants || [],
    status: r.status || "pending",
    reviewedBy: r.reviewed_by || "",
    reviewNotes: r.review_notes || "",
    rescheduledProposal: r.rescheduled_proposal || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function readMeetingRequests(filters = {}) {
  requireSupabase();
  let query = db().from("meeting_requests").select("*").order("proposed_date", { ascending: false });
  if (filters.requesterEmployeeId) query = query.eq("requester_employee_id", filters.requesterEmployeeId);
  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    query = query.in("status", statuses);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data || []).map(mapRow);

  // Participant-membership post-filter: when requested, only return meetings where
  // the employee is the requester OR is listed as a participant (employee:ID entry).
  if (filters.participantEmployeeId) {
    const id = filters.participantEmployeeId;
    const tag = `employee:${id}`;
    return rows.filter(
      (r) =>
        r.requesterEmployeeId === id ||
        (Array.isArray(r.participants) && r.participants.some((p) => p === tag || p === id))
    );
  }

  return rows;
}

async function readMeetingRequestById(id) {
  requireSupabase();
  const { data, error } = await db().from("meeting_requests").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

async function createMeetingRequest({ title, description, proposedDate, proposedTime, durationMinutes, requesterEmployeeId, requesterRole, participants }) {
  requireSupabase();
  const { data, error } = await db()
    .from("meeting_requests")
    .insert({
      title,
      description: description || null,
      proposed_date: proposedDate,
      proposed_time: proposedTime,
      duration_minutes: durationMinutes || 30,
      requester_employee_id: requesterEmployeeId,
      requester_role: requesterRole || "",
      participants: participants || [],
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

async function updateMeetingRequest(id, patch) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  if (patch.status) row.status = patch.status;
  if (patch.reviewedBy !== undefined) row.reviewed_by = patch.reviewedBy || null;
  if (patch.reviewNotes !== undefined) row.review_notes = patch.reviewNotes || null;
  if (patch.rescheduledProposal !== undefined) row.rescheduled_proposal = patch.rescheduledProposal || null;
  if (patch.proposedDate) row.proposed_date = patch.proposedDate;
  if (patch.proposedTime) row.proposed_time = patch.proposedTime;
  if (patch.durationMinutes != null) row.duration_minutes = patch.durationMinutes;
  if (patch.participants !== undefined) row.participants = patch.participants;
  const { error } = await db().from("meeting_requests").update(row).eq("id", id);
  if (error) throw new Error(error.message);
  return readMeetingRequestById(id);
}

module.exports = {
  readMeetingRequests,
  readMeetingRequestById,
  createMeetingRequest,
  updateMeetingRequest,
};
