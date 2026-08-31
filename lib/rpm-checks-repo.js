/**
 * CRUD for rpm_checks (Checks + Q Feedback funnel).
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const { stripMemberId, validateMemberId } = require("./rpm-member-id");
const { validateDigitsPhone, validatePersonName, digitsOnlyPhone } = require("./rpm-person-fields");
const {
  normalizeCheckStatus,
  normalizeFeedbackStatus,
} = require("./rpm-check-status");
const { storageDateParts, currentWorkingDay } = require("./sales-working-day");
const airtableHooks = require("./airtable-rpm-hooks");

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

function isUniqueViolation(err) {
  return err?.code === "23505" || /duplicate key|unique constraint/i.test(String(err?.message || err || ""));
}

function memberDayExistsError(existing) {
  const err = new Error(
    existing
      ? `MCN already logged today (${existing.agentId || "agent"}${existing.checkStatus ? ` · ${existing.checkStatus}` : ""}). Edit the existing check to change status.`
      : "MCN already logged today for this working day"
  );
  err.code = "MEMBER_DAY_EXISTS";
  err.existing = existing || null;
  return err;
}

function normalizePhone(raw) {
  return digitsOnlyPhone(raw);
}

async function findLiveByMemberDay({ company, memberIdNormalized, workingDay, excludeId } = {}) {
  const norm = stripMemberId(memberIdNormalized);
  if (!norm || !workingDay) return null;
  let q = liveQuery()
    .eq("member_id_normalized", norm)
    .eq("working_day", workingDay)
    .limit(5);
  if (company) q = q.eq("company", company || "hangup");
  const { data, error } = await q;
  if (error) {
    if (isTableMissing(error)) return null;
    throw new Error(error.message);
  }
  const rows = (data || [])
    .map(mapRow)
    .filter((r) => r && (!excludeId || r.id !== excludeId));
  return rows[0] || null;
}

function assertCheckMemberPhoneName({ memberId, phone, fullName, checkStatus, requireName }) {
  const memberCheck = validateMemberId(memberId);
  if (!memberCheck.ok) {
    const err = new Error(memberCheck.message || "Wrong MCN");
    err.code = memberCheck.message === "Member ID is required" ? "VALIDATION" : "WRONG_MCN";
    err.field = "memberId";
    throw err;
  }
  const phoneCheck = validateDigitsPhone(phone, { required: true, label: "Phone" });
  if (!phoneCheck.ok) {
    const err = new Error(phoneCheck.message);
    err.code = "VALIDATION";
    err.field = "phone";
    throw err;
  }
  const needName = requireName === true || checkStatus === "q";
  if (needName) {
    const nameCheck = validatePersonName(fullName, { required: true, label: "Full name" });
    if (!nameCheck.ok) {
      const err = new Error(nameCheck.message);
      err.code = "VALIDATION";
      err.field = "fullName";
      throw err;
    }
    return {
      memberId: memberCheck.value,
      memberDisplay: memberCheck.display,
      phone: phoneCheck.value,
      fullName: nameCheck.value,
    };
  }
  return {
    memberId: memberCheck.value,
    memberDisplay: memberCheck.display,
    phone: phoneCheck.value,
    fullName: "",
  };
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    company: r.company || "hangup",
    agentId: r.agent_id,
    memberId: r.member_id || "",
    memberIdNormalized: r.member_id_normalized || stripMemberId(r.member_id),
    fullName: r.full_name || "",
    dateOfBirth: r.date_of_birth || null,
    phone: r.phone || "",
    phoneNormalized: r.phone_normalized || normalizePhone(r.phone),
    team: r.team || "",
    unit: r.unit || "",
    checkStatus: r.check_status,
    feedbackStatus: r.feedback_status || null,
    info: r.info || "",
    submittedBy: r.submitted_by || null,
    closerId: r.closer_id || null,
    feedbackBy: r.feedback_by || null,
    feedbackAt: r.feedback_at || null,
    submissionDate: r.submission_date || null,
    submissionTime: r.submission_time || null,
    workingDay: r.working_day,
    linkedRpmSaleId: r.linked_rpm_sale_id || null,
    createdAt: r.created_at || null,
    updatedAt: r.updated_at || null,
    deletedAt: r.deleted_at || null,
    airtableRecordId: r.airtable_record_id || "",
    airtableSyncedAt: r.airtable_synced_at || null,
    airtableSyncError: r.airtable_sync_error || "",
  };
}

function isQFeedbackSheetImport(check) {
  const info = String(check?.info || "");
  const by = String(check?.submittedBy || check?.submitted_by || "");
  return (
    info.includes("[source:q-feedback-sheet]") ||
    info.includes("[import:qfb:") ||
    by.startsWith("import:qfb")
  );
}

function liveQuery() {
  return db().from("rpm_checks").select("*").is("deleted_at", null);
}

async function listChecks({
  company,
  workingDay,
  fromDay,
  toDay,
  agentId,
  checkStatus,
  feedbackStatus,
  openFeedbackOnly,
  team,
  limit = 500,
} = {}) {
  requireSupabase();
  let q = liveQuery().order("created_at", { ascending: false }).limit(Math.min(2000, Number(limit) || 500));
  if (company) q = q.eq("company", company);
  if (workingDay) q = q.eq("working_day", workingDay);
  if (fromDay) q = q.gte("working_day", fromDay);
  if (toDay) q = q.lte("working_day", toDay);
  if (agentId) q = q.eq("agent_id", agentId);
  if (checkStatus) q = q.eq("check_status", checkStatus);
  if (feedbackStatus) q = q.eq("feedback_status", feedbackStatus);
  if (openFeedbackOnly) {
    q = q.eq("check_status", "q").is("feedback_status", null);
  }
  if (team) q = q.eq("team", team);
  const { data, error } = await q;
  if (error) {
    if (isTableMissing(error)) return { checks: [], available: false };
    throw new Error(error.message);
  }
  return { checks: (data || []).map(mapRow), available: true };
}

async function getCheckById(id) {
  requireSupabase();
  const { data, error } = await liveQuery().eq("id", id).maybeSingle();
  if (error) {
    if (isTableMissing(error)) return { check: null, available: false };
    throw new Error(error.message);
  }
  return { check: mapRow(data), available: true };
}

async function setRpmCheckAirtableMeta(checkId, { recordId, syncedAt, error }) {
  requireSupabase();
  const row = {};
  if (recordId !== undefined) row.airtable_record_id = recordId || null;
  if (syncedAt !== undefined) row.airtable_synced_at = syncedAt || null;
  if (error !== undefined) row.airtable_sync_error = error || null;
  if (!Object.keys(row).length) return;
  const { error: dbErr } = await db().from("rpm_checks").update(row).eq("id", checkId);
  if (dbErr) throw new Error(dbErr.message);
}

async function listChecksLinkedToSale(saleId) {
  requireSupabase();
  if (!saleId) return [];
  const { data, error } = await liveQuery().eq("linked_rpm_sale_id", saleId);
  if (error) {
    if (isTableMissing(error)) return [];
    throw new Error(error.message);
  }
  return (data || []).map(mapRow);
}

async function createCheck(payload, opts = {}) {
  requireSupabase();
  const checkStatus = normalizeCheckStatus(payload.checkStatus);
  if (!checkStatus) throw new Error("Invalid checkStatus");
  const agentId = String(payload.agentId || "").trim();
  if (!agentId) throw new Error("agentId required");
  const validated = assertCheckMemberPhoneName({
    memberId: payload.memberId,
    phone: payload.phone,
    fullName: payload.fullName,
    checkStatus,
  });
  const dateOfBirth = payload.dateOfBirth || null;
  if (checkStatus === "q" && !dateOfBirth) throw new Error("Date of birth is required for Q checks");
  const submission = payload.submissionDate || null;
  const parts = submission
    ? storageDateParts(submission)
    : {
        submissionDate: currentWorkingDay(),
        submissionTime: null,
        workingDay: currentWorkingDay(),
      };
  const workingDay = payload.workingDay || parts.workingDay;
  const company = payload.company || "hangup";
  const existing = await findLiveByMemberDay({
    company,
    memberIdNormalized: validated.memberId,
    workingDay,
  });
  if (existing) throw memberDayExistsError(existing);

  const row = {
    company,
    agent_id: agentId,
    member_id: validated.memberDisplay || validated.memberId,
    member_id_normalized: validated.memberId,
    full_name: checkStatus === "q" ? validated.fullName : null,
    date_of_birth: checkStatus === "q" ? dateOfBirth : null,
    phone: validated.phone,
    phone_normalized: validated.phone || null,
    team: payload.team ? String(payload.team).trim() : null,
    unit: payload.unit ? String(payload.unit).trim() : null,
    check_status: checkStatus,
    feedback_status: null,
    info: payload.info ? String(payload.info).trim() : null,
    submitted_by: payload.submittedBy || null,
    closer_id: payload.closerId || null,
    submission_date: parts.submissionDate,
    submission_time: parts.submissionTime,
    working_day: workingDay,
    updated_at: new Date().toISOString(),
  };
  if (payload.createdAt) {
    const created = new Date(payload.createdAt);
    if (!Number.isNaN(created.getTime())) row.created_at = created.toISOString();
  }
  const { data, error } = await db().from("rpm_checks").insert(row).select().single();
  if (error) {
    if (isTableMissing(error)) {
      const err = new Error("rpm_checks table not available");
      err.code = "TABLE_MISSING";
      throw err;
    }
    if (isUniqueViolation(error)) {
      const again = await findLiveByMemberDay({
        company,
        memberIdNormalized: validated.memberId,
        workingDay,
      });
      throw memberDayExistsError(again);
    }
    throw new Error(error.message);
  }
  const mapped = mapRow(data);
  await airtableHooks.afterRpmCheckWrite(mapped.id, opts);
  return mapped;
}

async function updateCheck(id, patch, opts = {}) {
  requireSupabase();
  const { check: existing } = await getCheckById(id);
  if (!existing) throw new Error("Not found");

  const row = { updated_at: new Date().toISOString() };
  let nextStatus = existing.checkStatus;
  if (patch.checkStatus != null) {
    const s = normalizeCheckStatus(patch.checkStatus);
    if (!s) throw new Error("Invalid checkStatus");
    row.check_status = s;
    nextStatus = s;
    if (s !== "q") {
      row.feedback_status = null;
      row.feedback_by = null;
      row.feedback_at = null;
      row.closer_id = null;
      row.full_name = null;
      row.date_of_birth = null;
    }
  }

  let nextMember = existing.memberIdNormalized || stripMemberId(existing.memberId);
  let nextPhone = existing.phone;
  let nextName = existing.fullName;

  if (patch.memberId != null) {
    const memberCheck = validateMemberId(patch.memberId);
    if (!memberCheck.ok) {
      const err = new Error(memberCheck.message || "Wrong MCN");
      err.code = memberCheck.message === "Member ID is required" ? "VALIDATION" : "WRONG_MCN";
      err.field = "memberId";
      throw err;
    }
    row.member_id = memberCheck.display || memberCheck.value;
    row.member_id_normalized = memberCheck.value;
    nextMember = memberCheck.value;
  }
  if (patch.phone != null) {
    const phoneCheck = validateDigitsPhone(patch.phone, { required: true });
    if (!phoneCheck.ok) {
      const err = new Error(phoneCheck.message);
      err.code = "VALIDATION";
      err.field = "phone";
      throw err;
    }
    row.phone = phoneCheck.value;
    row.phone_normalized = phoneCheck.value;
    nextPhone = phoneCheck.value;
  }
  if (patch.fullName !== undefined) {
    if (nextStatus === "q" || existing.checkStatus === "q") {
      const nameCheck = validatePersonName(patch.fullName, { required: true });
      if (!nameCheck.ok) {
        const err = new Error(nameCheck.message);
        err.code = "VALIDATION";
        err.field = "fullName";
        throw err;
      }
      row.full_name = nameCheck.value;
      nextName = nameCheck.value;
    } else {
      row.full_name = patch.fullName ? String(patch.fullName).trim() : null;
    }
  }
  if (patch.dateOfBirth !== undefined) {
    row.date_of_birth = patch.dateOfBirth || null;
  }
  if (patch.info != null) row.info = String(patch.info).trim() || null;
  if (patch.team != null) row.team = String(patch.team).trim() || null;
  if (patch.unit != null) row.unit = String(patch.unit).trim() || null;
  if (patch.closerId !== undefined) row.closer_id = patch.closerId || null;
  if (patch.agentId != null) row.agent_id = String(patch.agentId).trim();

  if (nextStatus === "q") {
    const name = row.full_name !== undefined ? row.full_name : nextName;
    const dob = row.date_of_birth !== undefined ? row.date_of_birth : existing.dateOfBirth;
    if (!name) throw new Error("Full name is required for Q checks");
    if (!dob) throw new Error("Date of birth is required for Q checks");
  }

  if (nextMember) {
    const collide = await findLiveByMemberDay({
      company: existing.company,
      memberIdNormalized: nextMember,
      workingDay: existing.workingDay,
      excludeId: id,
    });
    if (collide) throw memberDayExistsError(collide);
  }

  const { data, error } = await db()
    .from("rpm_checks")
    .update(row)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) {
    if (isTableMissing(error)) {
      const err = new Error("rpm_checks table not available");
      err.code = "TABLE_MISSING";
      throw err;
    }
    if (isUniqueViolation(error)) {
      throw memberDayExistsError(
        await findLiveByMemberDay({
          company: existing.company,
          memberIdNormalized: nextMember,
          workingDay: existing.workingDay,
          excludeId: id,
        })
      );
    }
    throw new Error(error.message);
  }
  const mapped = mapRow(data);
  await airtableHooks.afterRpmCheckWrite(mapped.id, opts);
  return mapped;
}

async function softDeleteCheck(id, opts = {}) {
  requireSupabase();
  const { data, error } = await db()
    .from("rpm_checks")
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) {
    if (isTableMissing(error)) {
      const err = new Error("rpm_checks table not available");
      err.code = "TABLE_MISSING";
      throw err;
    }
    throw new Error(error.message);
  }
  const mapped = mapRow(data);
  await airtableHooks.afterRpmCheckDelete(mapped, opts);
  return mapped;
}

async function setFeedback(id, { feedbackStatus, info, closerId, feedbackBy }, opts = {}) {
  requireSupabase();
  const status = normalizeFeedbackStatus(feedbackStatus);
  if (!status) throw new Error("Invalid feedbackStatus");
  const row = {
    feedback_status: status,
    feedback_by: feedbackBy || null,
    feedback_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (info != null) row.info = String(info).trim() || null;
  if (closerId !== undefined) row.closer_id = closerId || null;
  const { data, error } = await db()
    .from("rpm_checks")
    .update(row)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) {
    if (isTableMissing(error)) {
      const err = new Error("rpm_checks table not available");
      err.code = "TABLE_MISSING";
      throw err;
    }
    throw new Error(error.message);
  }
  const mapped = mapRow(data);
  await airtableHooks.afterRpmCheckWrite(mapped.id, opts);
  return mapped;
}

/** Clear disposition so the Q shows as open / no feedback. */
async function clearFeedback(id, opts = {}) {
  requireSupabase();
  const { data, error } = await db()
    .from("rpm_checks")
    .update({
      feedback_status: null,
      feedback_by: null,
      feedback_at: null,
      closer_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) {
    if (isTableMissing(error)) {
      const err = new Error("rpm_checks table not available");
      err.code = "TABLE_MISSING";
      throw err;
    }
    throw new Error(error.message);
  }
  const mapped = mapRow(data);
  await airtableHooks.afterRpmCheckWrite(mapped.id, opts);
  return mapped;
}

async function linkSaleToCheck(checkId, saleId, opts = {}) {
  requireSupabase();
  let saleCloserId = null;
  if (saleId) {
    const { data: saleRow } = await db()
      .from("rpm_sales")
      .select("closer_id")
      .eq("id", saleId)
      .maybeSingle();
    const raw = saleRow?.closer_id != null ? String(saleRow.closer_id).trim() : "";
    saleCloserId = raw || null;
  }
  const patch = {
    linked_rpm_sale_id: saleId,
    feedback_status: "sale",
    feedback_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (saleCloserId) patch.closer_id = saleCloserId;
  const { data, error } = await db()
    .from("rpm_checks")
    .update(patch)
    .eq("id", checkId)
    .is("deleted_at", null)
    .is("linked_rpm_sale_id", null)
    .select()
    .maybeSingle();
  if (error) {
    if (isTableMissing(error)) return null;
    throw new Error(error.message);
  }
  const mapped = mapRow(data);
  if (mapped) {
    await airtableHooks.afterRpmCheckWrite(mapped.id, opts);
    if (saleId) await airtableHooks.afterRpmSaleWrite(saleId, opts);
  }
  return mapped;
}

async function clearSaleLink(saleId, opts = {}) {
  requireSupabase();
  const linked = await listChecksLinkedToSale(saleId);
  const { error } = await db()
    .from("rpm_checks")
    .update({
      linked_rpm_sale_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("linked_rpm_sale_id", saleId)
    .is("deleted_at", null);
  if (error && !isTableMissing(error)) throw new Error(error.message);
  for (const check of linked) {
    await airtableHooks.afterRpmCheckWrite(check.id, opts);
  }
  return linked;
}

async function findOpenQForAutoLink({ company, agentId, memberIdNormalized, workingDay }) {
  requireSupabase();
  const norm = stripMemberId(memberIdNormalized);
  if (!norm || !workingDay) return null;
  let q = liveQuery()
    .eq("member_id_normalized", norm)
    .eq("check_status", "q")
    .eq("working_day", workingDay)
    .is("linked_rpm_sale_id", null)
    .order("created_at", { ascending: true });
  if (company) q = q.eq("company", company);
  const { data, error } = await q.limit(25);
  if (error) {
    if (isTableMissing(error)) return null;
    throw new Error(error.message);
  }
  const rows = (data || []).map(mapRow);
  if (!rows.length) return null;
  if (agentId) {
    const sameAgent = rows.find((r) => String(r.agentId) === String(agentId));
    if (sameAgent) return sameAgent;
  }
  return rows[0];
}

async function findSaleCandidateForCheck({ company, agentId, memberIdNormalized, listSalesFn }) {
  if (typeof listSalesFn !== "function") return null;
  const sales = await listSalesFn({ company, agentId, memberIdNormalized });
  return (sales || [])[0] || null;
}

async function dashboardSummary({ company, workingDay, agentIds } = {}) {
  const { checks, available } = await listChecks({
    company,
    workingDay,
    limit: 2000,
  });
  if (!available) return { available: false, totals: emptyTotals() };
  const scoped = agentIds
    ? checks.filter((c) => agentIds.has(c.agentId) || agentIds.has(String(c.agentId)))
    : checks;
  const totals = emptyTotals();
  const feedback = {
    open: 0,
    dropped_with_client: 0,
    callback: 0,
    not_int: 0,
    retransfer: 0,
    sale: 0,
  };
  for (const c of scoped) {
    if (isQFeedbackSheetImport(c)) continue;
    if (totals[c.checkStatus] != null) totals[c.checkStatus] += 1;
    if (c.checkStatus === "q") {
      if (!c.feedbackStatus) feedback.open += 1;
      else if (feedback[c.feedbackStatus] != null) feedback[c.feedbackStatus] += 1;
    }
  }
  totals.totalChecks =
    totals.q + totals.nq + totals.age_limit + totals.under_age + totals.duplicate;
  return { available: true, totals, feedback, workingDay };
}

function emptyTotals() {
  return {
    q: 0,
    nq: 0,
    age_limit: 0,
    under_age: 0,
    duplicate: 0,
    totalChecks: 0,
  };
}

module.exports = {
  listChecks,
  getCheckById,
  createCheck,
  updateCheck,
  softDeleteCheck,
  setFeedback,
  clearFeedback,
  linkSaleToCheck,
  clearSaleLink,
  findOpenQForAutoLink,
  findSaleCandidateForCheck,
  listChecksLinkedToSale,
  setRpmCheckAirtableMeta,
  dashboardSummary,
  findLiveByMemberDay,
  isQFeedbackSheetImport,
  mapRow,
  isTableMissing,
  normalizePhone,
  memberDayExistsError,
  assertCheckMemberPhoneName,
};
