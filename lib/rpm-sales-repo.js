/**
 * RPM sales CRUD + attachments (repo layer).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const workingDay = require("./sales-working-day");
const rpmStatus = require("./rpm-sales-status");
const identity = require("./rpm-sale-identity");
const recycleBin = require("./recycle-bin");
const airtableHooks = require("./airtable-rpm-hooks");

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires Supabase backend");
}

function db() {
  return getSupabaseAdmin();
}

function mapRpmSale(r) {
  const formData = r.form_data && typeof r.form_data === "object" ? r.form_data : {};
  const dateOnly = String(r.submission_date || "").slice(0, 10);
  const submissionTime =
    r.submission_time || workingDay.computeSubmissionTime(r.submission_date) || "";
  const submissionDate = workingDay.combineSubmissionDateTime(dateOnly || r.submission_date, submissionTime);
  const workingDayVal =
    r.working_day || workingDay.computeWorkingDay(submissionDate) || dateOnly;
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
    airtableRecordId: r.airtable_record_id || "",
    airtableSyncedAt: r.airtable_synced_at || null,
    airtableSyncError: r.airtable_sync_error || "",
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

function submissionDateKey(sale) {
  return String(sale.submissionDate || "").slice(0, 10);
}

function filterSales(rows, filters = {}) {
  let out = rows;
  if (filters.day) {
    out = out.filter((s) => String(s.workingDay || "") === String(filters.day));
  } else {
    if (filters.from) out = out.filter((s) => submissionDateKey(s) >= String(filters.from));
    if (filters.to) out = out.filter((s) => submissionDateKey(s) <= String(filters.to));
  }
  if (filters.agentId) out = out.filter((s) => s.agentId === filters.agentId);
  if (filters.closerId) out = out.filter((s) => s.closerId === filters.closerId);
  if (filters.client) out = out.filter((s) => String(s.client || "") === String(filters.client));
  if (filters.team) out = out.filter((s) => s.team === filters.team);
  if (filters.unit) out = out.filter((s) => s.unit === filters.unit);
  if (filters.status) out = out.filter((s) => s.status === filters.status);
  if (filters.reviewerFeedback) {
    out = out.filter(
      (s) => String(s.formData?.reviewerFeedback || "") === String(filters.reviewerFeedback)
    );
  }
  if (filters.clientFeedback) {
    out = out.filter(
      (s) => String(s.formData?.clientFeedback || "") === String(filters.clientFeedback)
    );
  }
  if (filters.retransfer === "1" || filters.retransfer === true) {
    out = out.filter((s) => {
      const fd = s.formData || {};
      return fd.clientFeedback === rpmStatus.CLIENT_RETRANSFER || fd.retransfer === true;
    });
  }
  return out;
}

function sortRpmSales(rows, sort = "latest") {
  const oldestFirst = String(sort || "latest").toLowerCase() === "oldest";
  const dir = oldestFirst ? 1 : -1;
  return [...(rows || [])].sort((a, b) => {
    const da = String(a.submissionDate || "");
    const db = String(b.submissionDate || "");
    if (da !== db) return da < db ? -dir : dir;
    const ta = String(a.submissionTime || "");
    const tb = String(b.submissionTime || "");
    if (ta !== tb) return ta < tb ? -dir : dir;
    const ca = String(a.createdAt || "");
    const cb = String(b.createdAt || "");
    if (ca !== cb) return ca < cb ? -dir : dir;
    return 0;
  });
}

async function readRpmSales(filters = {}) {
  if (!useSupabase()) return filters.withMeta ? { rows: [], truncated: false } : [];
  const oldestFirst = String(filters.sort || "latest").toLowerCase() === "oldest";
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 1000, 100), 1000);
  const maxRows = Math.min(Math.max(Number(filters.maxRows) || 20000, pageSize), 50000);

  function baseQuery() {
    let q = db()
      .from("rpm_sales")
      .select("*")
      .order("submission_date", { ascending: oldestFirst })
      .order("submission_time", { ascending: oldestFirst })
      .order("created_at", { ascending: oldestFirst });
    if (filters.agentId) q = q.eq("agent_id", filters.agentId);
    if (filters.closerId) q = q.eq("closer_id", filters.closerId);
    if (filters.client) q = q.eq("client", filters.client);
    if (filters.team) q = q.eq("team", filters.team);
    if (filters.unit) q = q.eq("unit", filters.unit);
    if (filters.status) q = q.eq("status", filters.status);
    if (filters.day) {
      q = q.eq("working_day", filters.day);
    } else {
      if (filters.from) q = q.gte("submission_date", filters.from);
      if (filters.to) q = q.lte("submission_date", filters.to);
    }
    return q;
  }

  let rows = [];
  let fromIdx = 0;
  let truncated = false;
  for (;;) {
    const { data, error } = await baseQuery().range(fromIdx, fromIdx + pageSize - 1);
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        return filters.withMeta ? { rows: [], truncated: false } : [];
      }
      throw new Error(error.message);
    }
    const batch = data || [];
    rows = rows.concat(batch.map(mapRpmSale));
    if (batch.length < pageSize) break;
    fromIdx += pageSize;
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
  }
  rows = filterSales(rows, {
    retransfer: filters.retransfer,
    reviewerFeedback: filters.reviewerFeedback,
    clientFeedback: filters.clientFeedback,
  });
  rows = sortRpmSales(rows, filters.sort);
  if (filters.withMeta) return { rows, truncated };
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

async function setRpmSaleAirtableMeta(saleId, { recordId, syncedAt, error }) {
  requireSupabase();
  const row = {};
  if (recordId !== undefined) row.airtable_record_id = recordId || null;
  if (syncedAt !== undefined) row.airtable_synced_at = syncedAt || null;
  if (error !== undefined) row.airtable_sync_error = error || null;
  if (!Object.keys(row).length) return;
  const { error: dbErr } = await db().from("rpm_sales").update(row).eq("id", saleId);
  if (dbErr) throw new Error(dbErr.message);
}

async function createRpmSale(payload, actor, opts = {}) {
  requireSupabase();
  const dates = workingDay.enrichSaleDates(payload, payload.submissionDate);
  const stored = workingDay.storageDateParts(dates.submissionDate);
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
    submission_date: stored.submissionDate,
    submission_time: stored.submissionTime,
    working_day: stored.workingDay,
    effective_date: payload.effectiveDate || dates.effectiveDate || stored.workingDay,
    feedback: payload.feedback || "",
    team: payload.team || "",
    unit: payload.unit || "",
    form_data: fd,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("rpm_sales").insert(row).select().single();
  if (error) throw new Error(error.message);
  const sale = mapRpmSale(data);
  await airtableHooks.afterRpmSaleWrite(sale.id, opts);
  return sale;
}

function normalizePhoneDigits(phone) {
  return identity.normalizePhoneDigits(phone);
}

async function findRecentDuplicateRpmSale({ phoneNumber, agentId, ignoreAgent, workingDay: day }) {
  requireSupabase();
  const norm = normalizePhoneDigits(phoneNumber);
  if (!norm) return null;
  if (ignoreAgent) {
    const d = String(day || "").slice(0, 10);
    if (!d) return null;
    const { data, error } = await db()
      .from("rpm_sales")
      .select("id, phone_number, agent_id, working_day, created_at, form_data, member_id, status, feedback, submission_date")
      .eq("working_day", d)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) return null;
      throw new Error(error.message);
    }
    const match = (data || []).find((r) => identity.collectRpmSalePhones(r).includes(norm));
    return match ? mapRpmSale(match) : null;
  }
  if (!agentId) return null;
  const since = new Date(Date.now() - 120000).toISOString();
  const { data, error } = await db()
    .from("rpm_sales")
    .select("id, phone_number, agent_id, created_at, form_data, member_id, status, feedback, submission_date, working_day")
    .eq("agent_id", agentId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  const match = (data || []).find((r) => identity.collectRpmSalePhones(r).includes(norm));
  return match ? mapRpmSale(match) : null;
}

/**
 * Find prior RPM sales that share main/alt phone digits or member ID (historical, not just recent).
 */
async function findIdentityDuplicateRpmSales({
  phoneNumbers = [],
  memberId = "",
  excludeId = null,
  limit = 40,
} = {}) {
  requireSupabase();
  const norms = [
    ...new Set(
      (phoneNumbers || [])
        .map((p) => normalizePhoneDigits(p))
        .filter((p) => p.length >= 7)
    ),
  ];
  const mid = identity.normalizeMemberIdKey(memberId);
  if (!norms.length && !mid) return [];

  const byId = new Map();
  const memberLib = require("./rpm-member-id");

  if (mid) {
    const candidates = [...new Set([mid, memberLib.formatMemberId(mid), String(memberId || "").trim()].filter(Boolean))];
    for (const candidate of candidates) {
      const { data, error } = await db().from("rpm_sales").select("*").eq("member_id", candidate).limit(limit);
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) break;
        throw new Error(error.message);
      }
      for (const r of data || []) {
        if (identity.normalizeMemberIdKey(r.member_id) === mid) byId.set(r.id, r);
      }
    }
  }

  for (const norm of norms) {
    const tail = norm.slice(-7);
    const orFilter = [
      `phone_number.ilike.%${tail}%`,
      `form_data->>alternativePhone.ilike.%${tail}%`,
      `form_data->>alternativePhoneNumber.ilike.%${tail}%`,
      `form_data->>altPhone.ilike.%${tail}%`,
      `form_data->>phoneNumber.ilike.%${tail}%`,
    ].join(",");
    const { data, error } = await db().from("rpm_sales").select("*").or(orFilter).limit(200);
    if (error) {
      // Fallback if JSON path operators unsupported — scan phone_number only
      const { data: fallback, error: err2 } = await db()
        .from("rpm_sales")
        .select("*")
        .ilike("phone_number", `%${tail}%`)
        .limit(200);
      if (err2) {
        if (/does not exist|schema cache/i.test(err2.message)) continue;
        throw new Error(err2.message);
      }
      for (const r of fallback || []) {
        if (identity.collectRpmSalePhones(r).some((p) => norms.includes(p))) byId.set(r.id, r);
      }
      continue;
    }
    for (const r of data || []) {
      if (identity.collectRpmSalePhones(r).some((p) => norms.includes(p))) byId.set(r.id, r);
    }
  }

  return [...byId.values()]
    .map(mapRpmSale)
    .filter((s) => !excludeId || String(s.id) !== String(excludeId))
    .slice(0, limit);
}

async function deleteRpmSaleCompletely(id, actor, opts = {}) {
  requireSupabase();
  const existing = await getRpmSale(id);
  if (!existing) throw new Error("Sale not found");
  await airtableHooks.afterRpmSaleDelete(existing, opts);
  try {
    const rpmChecksRepo = require("./rpm-checks-repo");
    await rpmChecksRepo.clearSaleLink(id, opts);
  } catch {
    /* table may be missing */
  }
  const attachments = await readRpmSaleAttachments(id);
  for (const att of attachments) {
    try {
      await recycleBin.archiveLiveRow({
        table: "rpm_sales_attachments",
        id: att.id,
        storagePaths: att.dropboxPath ? [att.dropboxPath] : [],
        deletedBy: actor,
      });
    } catch {
      await db().from("rpm_sales_attachments").delete().eq("id", att.id);
    }
  }
  await recycleBin.archiveLiveRow({
    table: "rpm_sales",
    id,
    deletedBy: actor,
  });
  return { ok: true, id };
}

/**
 * Keep sales that share phone (main/alt) or member ID with at least one other sale in the list,
 * sorted so duplicate groups sit together.
 */
function filterAndGroupDuplicateRpmSales(rows = []) {
  const list = rows || [];
  if (list.length < 2) return [];

  const phoneToIds = new Map();
  const midToIds = new Map();
  for (const s of list) {
    const id = String(s.id);
    for (const p of identity.collectRpmSalePhones(s)) {
      if (!phoneToIds.has(p)) phoneToIds.set(p, new Set());
      phoneToIds.get(p).add(id);
    }
    const mid = identity.normalizeMemberIdKey(s.memberId || s.formData?.memberId);
    if (mid) {
      if (!midToIds.has(mid)) midToIds.set(mid, new Set());
      midToIds.get(mid).add(id);
    }
  }

  const dupIds = new Set();
  for (const set of phoneToIds.values()) {
    if (set.size >= 2) for (const id of set) dupIds.add(id);
  }
  for (const set of midToIds.values()) {
    if (set.size >= 2) for (const id of set) dupIds.add(id);
  }
  if (!dupIds.size) return [];

  const out = list.filter((s) => dupIds.has(String(s.id)));
  out.sort((a, b) => {
    const ka = identity.duplicateGroupKey(a);
    const kb = identity.duplicateGroupKey(b);
    if (ka !== kb) return ka.localeCompare(kb);
    return String(a.submissionDate || "").localeCompare(String(b.submissionDate || ""));
  });
  return out;
}

function applySubmissionPatch(row, patch) {
  if (patch.submissionDate === undefined && patch.submissionTime === undefined && patch.workingDay === undefined) {
    return;
  }

  if (patch.submissionDate !== undefined) {
    const dateOnlyHint = /^\d{4}-\d{2}-\d{2}$/.test(String(patch.submissionDate).trim());
    const full =
      dateOnlyHint && patch.submissionTime !== undefined
        ? `${String(patch.submissionDate).trim()} ${patch.submissionTime}`
        : patch.submissionDate;
    const stored = workingDay.storageDateParts(full);
    row.submission_date = stored.submissionDate;
    row.submission_time =
      patch.submissionTime !== undefined
        ? workingDay.parseSubmissionParts(`${stored.submissionDate} ${patch.submissionTime}`).time
        : stored.submissionTime;
    row.working_day =
      patch.workingDay !== undefined
        ? patch.workingDay
        : workingDay.computeWorkingDay(`${row.submission_date} ${row.submission_time}`);
    return;
  }

  if (patch.submissionTime !== undefined) {
    row.submission_time = workingDay.parseSubmissionParts(`2000-01-01 ${patch.submissionTime}`).time;
  }
  if (patch.workingDay !== undefined) {
    row.working_day = patch.workingDay;
  }
}

async function updateRpmSale(id, patch, actor, opts = {}) {
  requireSupabase();
  void actor;
  const row = { updated_at: new Date().toISOString() };
  applySubmissionPatch(row, patch);

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
  const sale = mapRpmSale(data);
  await airtableHooks.afterRpmSaleWrite(sale.id, opts);
  return sale;
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

async function createRpmSaleAttachment({ rpmSaleId, kind, fileName, dropboxPath, dropboxLink }, actor, opts = {}) {
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
  await airtableHooks.afterRpmSaleWrite(rpmSaleId, opts);
  return mapRpmAttachment(data);
}

async function deleteRpmSaleAttachment(id, actor, opts = {}) {
  requireSupabase();
  const { data, error } = await db().from("rpm_sales_attachments").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const recycleBin = require("./recycle-bin");
  await recycleBin.archiveLiveRow({
    table: "rpm_sales_attachments",
    id,
    storagePaths: data.dropbox_path ? [data.dropbox_path] : [],
    deletedBy: actor,
  });
  await airtableHooks.afterRpmSaleWrite(data.rpm_sale_id, opts);
  return mapRpmAttachment(data);
}

module.exports = {
  mapRpmSale,
  readRpmSales,
  getRpmSale,
  createRpmSale,
  setRpmSaleAirtableMeta,
  findRecentDuplicateRpmSale,
  findIdentityDuplicateRpmSales,
  updateRpmSale,
  deleteRpmSaleCompletely,
  readRpmSaleAttachments,
  getRpmSaleAttachment,
  createRpmSaleAttachment,
  deleteRpmSaleAttachment,
  filterSales,
  filterAndGroupDuplicateRpmSales,
  sortRpmSales,
  normalizePhoneDigits,
};
