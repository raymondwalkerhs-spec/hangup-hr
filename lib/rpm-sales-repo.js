/**
 * RPM sales CRUD + attachments (repo layer).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const workingDay = require("./sales-working-day");
const rpmStatus = require("./rpm-sales-status");

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires Supabase backend");
}

function db() {
  return getSupabaseAdmin();
}

function mapRpmSale(r) {
  const formData = r.form_data && typeof r.form_data === "object" ? r.form_data : {};
  const submissionDate = r.submission_date;
  const workingDayVal =
    r.working_day || workingDay.computeWorkingDay(submissionDate) || String(submissionDate || "").slice(0, 10);
  const submissionTime = r.submission_time || workingDay.computeSubmissionTime(submissionDate) || "";
  return {
    id: r.id,
    phoneNumber: r.phone_number || formData.phoneNumber || "",
    fullName: r.full_name || formData.fullName || "",
    client: r.client || formData.client || "",
    memberId: r.member_id || formData.memberId || "",
    agentId: r.agent_id,
    closerId: r.closer_id || "",
    submittedBy: r.submitted_by,
    status: r.status,
    submissionDate,
    submissionTime,
    workingDay: workingDayVal,
    effectiveDate: r.effective_date,
    feedback: r.feedback || formData.feedback || "",
    team: r.team || formData.team || "",
    unit: r.unit || formData.unit || "",
    reviewedBy: r.reviewed_by || "",
    reviewedAt: r.reviewed_at || null,
    createdAt: r.created_at,
    formData,
    program: "rpm",
  };
}

function mapRpmAttachment(r) {
  return {
    id: r.id,
    saleId: r.rpm_sale_id,
    rpmSaleId: r.rpm_sale_id,
    kind: r.kind,
    fileName: r.file_name,
    dropboxPath: r.dropbox_path,
    dropboxLink: r.dropbox_link || "",
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  };
}

function filterSales(rows, filters = {}) {
  let out = rows;
  if (filters.from) out = out.filter((s) => String(s.submissionDate || "") >= String(filters.from));
  if (filters.to) out = out.filter((s) => String(s.submissionDate || "") <= String(filters.to));
  if (filters.agentId) out = out.filter((s) => s.agentId === filters.agentId);
  if (filters.closerId) out = out.filter((s) => s.closerId === filters.closerId);
  if (filters.client) out = out.filter((s) => String(s.client || "") === String(filters.client));
  if (filters.team) out = out.filter((s) => s.team === filters.team);
  if (filters.unit) out = out.filter((s) => s.unit === filters.unit);
  if (filters.status) out = out.filter((s) => s.status === filters.status);
  if (filters.retransfer === "1" || filters.retransfer === true) {
    out = out.filter((s) => {
      const fd = s.formData || {};
      return fd.clientFeedback === rpmStatus.CLIENT_RETRANSFER || fd.retransfer === true;
    });
  }
  return out;
}

async function readRpmSales(filters = {}) {
  if (!useSupabase()) return [];
  let q = db().from("rpm_sales").select("*").order("submission_date", { ascending: false });
  if (filters.agentId) q = q.eq("agent_id", filters.agentId);
  if (filters.closerId) q = q.eq("closer_id", filters.closerId);
  if (filters.client) q = q.eq("client", filters.client);
  if (filters.team) q = q.eq("team", filters.team);
  if (filters.unit) q = q.eq("unit", filters.unit);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.from) q = q.gte("submission_date", filters.from);
  if (filters.to) q = q.lte("submission_date", filters.to);
  const { data, error } = await q;
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  let rows = (data || []).map(mapRpmSale);
  if (filters.retransfer === "1" || filters.retransfer === true) {
    rows = filterSales(rows, { retransfer: true });
  }
  return rows;
}

async function getRpmSale(id) {
  requireSupabase();
  const { data, error } = await db().from("rpm_sales").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? mapRpmSale(data) : null;
}

async function createRpmSale(payload, actor) {
  requireSupabase();
  const dates = workingDay.enrichSaleDates(payload, payload.submissionDate);
  const fd = { ...(payload.formData || {}) };
  if (!fd.leadType) fd.leadType = require("./sales-rpm-field-catalog").LEAD_TYPE_DEFAULT;
  const row = {
    phone_number: payload.phoneNumber,
    full_name: payload.fullName,
    client: payload.client || "",
    member_id: payload.memberId || fd.memberId || "",
    agent_id: payload.agentId,
    closer_id: payload.closerId || null,
    submitted_by: actor,
    status: payload.status || "pending",
    submission_date: dates.submissionDate,
    submission_time: dates.submissionTime,
    working_day: dates.workingDay,
    effective_date: payload.effectiveDate || dates.effectiveDate || dates.workingDay,
    feedback: payload.feedback || "",
    team: payload.team || "",
    unit: payload.unit || "",
    form_data: fd,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("rpm_sales").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapRpmSale(data);
}

function normalizePhoneDigits(phone) {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

async function findRecentDuplicateRpmSale({ phoneNumber, agentId }) {
  requireSupabase();
  const norm = normalizePhoneDigits(phoneNumber);
  if (!norm || !agentId) return null;
  const since = new Date(Date.now() - 120000).toISOString();
  const { data, error } = await db()
    .from("rpm_sales")
    .select("id, phone_number, agent_id, created_at")
    .eq("agent_id", agentId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  const match = (data || []).find((r) => normalizePhoneDigits(r.phone_number) === norm);
  return match ? mapRpmSale(match) : null;
}

async function updateRpmSale(id, patch, actor) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  const map = {
    status: "status",
    feedback: "feedback",
    effectiveDate: "effective_date",
    reviewedBy: "reviewed_by",
    phoneNumber: "phone_number",
    fullName: "full_name",
    client: "client",
    memberId: "member_id",
    closerId: "closer_id",
    agentId: "agent_id",
    submissionDate: "submission_date",
    submissionTime: "submission_time",
    workingDay: "working_day",
    team: "team",
    unit: "unit",
    formData: "form_data",
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] !== undefined) row[col] = patch[k];
  }
  if (patch.reviewedBy !== undefined || patch.status !== undefined) {
    row.reviewed_at = new Date().toISOString();
  }
  const { data, error } = await db().from("rpm_sales").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapRpmSale(data);
}

async function readRpmSaleAttachments(rpmSaleId) {
  requireSupabase();
  const { data, error } = await db()
    .from("rpm_sales_attachments")
    .select("*")
    .eq("rpm_sale_id", rpmSaleId)
    .order("created_at");
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapRpmAttachment);
}

async function getRpmSaleAttachment(id) {
  requireSupabase();
  const { data, error } = await db().from("rpm_sales_attachments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRpmAttachment(data) : null;
}

async function createRpmSaleAttachment({ rpmSaleId, kind, fileName, dropboxPath, dropboxLink }, actor) {
  requireSupabase();
  const { data, error } = await db()
    .from("rpm_sales_attachments")
    .insert({
      rpm_sale_id: rpmSaleId,
      kind,
      file_name: fileName,
      dropbox_path: dropboxPath,
      dropbox_link: dropboxLink || null,
      uploaded_by: actor,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRpmAttachment(data);
}

async function deleteRpmSaleAttachment(id) {
  requireSupabase();
  const { data, error } = await db().from("rpm_sales_attachments").delete().eq("id", id).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRpmAttachment(data) : null;
}

module.exports = {
  mapRpmSale,
  readRpmSales,
  getRpmSale,
  createRpmSale,
  findRecentDuplicateRpmSale,
  updateRpmSale,
  readRpmSaleAttachments,
  getRpmSaleAttachment,
  createRpmSaleAttachment,
  deleteRpmSaleAttachment,
  filterSales,
};
