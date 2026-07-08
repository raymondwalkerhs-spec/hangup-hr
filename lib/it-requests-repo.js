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
    employeeId: r.employee_id,
    title: r.title,
    description: r.description || "",
    category: r.category || "other",
    urgency: r.urgency || "normal",
    status: r.status || "open",
    assignedTo: r.assigned_to || "",
    unit: r.unit || "",
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at || null,
    resolutionNotes: r.resolution_notes || "",
    notesHiddenFromRequester: r.notes_hidden_from_requester || "",
    // routing workflow
    approvedBy: r.approved_by || "",
    approvedAt: r.approved_at || null,
    deniedBy: r.denied_by || "",
    deniedAt: r.denied_at || null,
    denialReason: r.denial_reason || "",
    reassignedBy: r.reassigned_by || "",
    reassignedAt: r.reassigned_at || null,
  };
}

async function readItRequests(filters = {}) {
  requireSupabase();
  let query = db()
    .from("it_requests")
    .select("*, it_request_scope(*)")
    .order("created_at", { ascending: false });
  if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
  if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);
  if (filters.unit) query = query.eq("unit", filters.unit);
  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    query = query.in("status", statuses);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    ...mapRow(r),
    scope: (r.it_request_scope || []).map((s) => ({
      scopeType: s.scope_type,
      scopeValue: s.scope_value,
    })),
  }));
}

async function readItRequestById(id) {
  requireSupabase();
  const { data, error } = await db()
    .from("it_requests")
    .select("*, it_request_scope(*)")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return {
    ...mapRow(data),
    scope: (data.it_request_scope || []).map((s) => ({
      scopeType: s.scope_type,
      scopeValue: s.scope_value,
    })),
  };
}

async function createItRequest({ employeeId, title, description, category, urgency, createdBy, scope, unit }) {
  requireSupabase();
  const { data, error } = await db()
    .from("it_requests")
    .insert({
      employee_id: employeeId,
      title,
      description: description || null,
      category: category || "other",
      urgency: urgency || "normal",
      status: "open",
      created_by: createdBy,
      unit: unit || null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  if (scope && scope.length) {
    const scopeRows = scope.map((s) => ({
      request_id: data.id,
      scope_type: s.scopeType,
      scope_value: s.scopeValue,
    }));
    const { error: scopeErr } = await db().from("it_request_scope").insert(scopeRows);
    if (scopeErr) throw new Error(scopeErr.message);
  }
  return readItRequestById(data.id);
}

async function updateItRequest(id, patch) {
  requireSupabase();
  const now = new Date().toISOString();
  const row = { updated_at: now };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo || null;
  if (patch.resolutionNotes !== undefined) row.resolution_notes = patch.resolutionNotes || null;
  if (patch.notesHiddenFromRequester !== undefined)
    row.notes_hidden_from_requester = patch.notesHiddenFromRequester || null;
  if (patch.status === "resolved" || patch.status === "closed") row.resolved_at = now;

  // routing actions
  if (patch.approvedBy !== undefined) {
    row.approved_by = patch.approvedBy || null;
    row.approved_at = patch.approvedBy ? now : null;
  }
  if (patch.deniedBy !== undefined) {
    row.denied_by = patch.deniedBy || null;
    row.denied_at = patch.deniedBy ? now : null;
    if (patch.denialReason !== undefined) row.denial_reason = patch.denialReason || null;
  }
  if (patch.reassignedBy !== undefined) {
    row.reassigned_by = patch.reassignedBy || null;
    row.reassigned_at = patch.reassignedBy ? now : null;
  }
  if (patch.unit !== undefined) row.unit = patch.unit || null;

  const { error } = await db().from("it_requests").update(row).eq("id", id);
  if (error) throw new Error(error.message);
  return readItRequestById(id);
}

async function deleteItRequest(id) {
  requireSupabase();
  const { error } = await db().from("it_requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Returns app_users with is_it=true (IT Access flag), enriched with their
 * linked employee unit. Optionally scoped to a specific unit (for ticket routing).
 * Falls back to role='it' if the column doesn't exist yet (pre-migration).
 */
async function readItUsers(options = {}) {
  requireSupabase();
  const { unit } = options || {};
  let query;

  // Try is_it flag first; fall back to role filter if column doesn't exist
  try {
    query = db()
      .from("app_users")
      .select("username, employee_id, role, status, is_it")
      .eq("is_it", true)
      .eq("status", "active");
  } catch {
    query = db()
      .from("app_users")
      .select("username, employee_id, role, status")
      .eq("role", "it")
      .eq("status", "active");
  }

  const { data, error } = await query;
  if (error) {
    // Column doesn't exist yet — fall back to role filter
    if (/is_it|column.*not.*exist/i.test(error.message)) {
      const { data: d2, error: e2 } = await db()
        .from("app_users")
        .select("username, employee_id, role, status")
        .eq("role", "it")
        .eq("status", "active");
      if (e2) throw new Error(e2.message);
      return (d2 || []).map((u) => ({ username: u.username, employeeId: u.employee_id || "" }));
    }
    throw new Error(error.message);
  }

  let users = (data || []).map((u) => ({
    username: u.username,
    employeeId: u.employee_id || "",
  }));

  // Unit-scope: if a unit is specified, only return IT users whose linked employee is in that unit
  if (unit && unit.trim()) {
    const { data: empData } = await db()
      .from("employees")
      .select("id")
      .eq("unit", unit.trim());
    const unitEmpIds = new Set((empData || []).map((e) => e.id));
    users = users.filter((u) => u.employeeId && unitEmpIds.has(u.employeeId));
    // If nobody in that unit has IT access, return all IT users as fallback
    if (!users.length) {
      users = (data || []).map((u) => ({ username: u.username, employeeId: u.employee_id || "" }));
    }
  }

  return users;
}

module.exports = {
  readItRequests,
  readItRequestById,
  createItRequest,
  updateItRequest,
  deleteItRequest,
  readItUsers,
};
