/**
 * Supabase CRUD for HRMS advanced tables.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Feature requires DATA_BACKEND=supabase");
}

const CLEARANCE_KEYS = ["clearance_form", "equipment_handover", "files_handover"];

const ORG_STRUCTURE = {
  dialing: { label: "Dialing agents", reportsTo: "OP Manager" },
  hr: { label: "HR team", reportsTo: "HR Manager" },
  quality: { label: "Quality team", reportsTo: "Backend" },
  rtm: { label: "RTM team", reportsTo: "CEO" },
  admins: { label: "Admins team", reportsTo: "CEO" },
  finance: { label: "Finance team", reportsTo: "CEO" },
};

async function readAllEmploymentPeriods() {
  requireSupabase();
  const { data, error } = await db().from("employment_periods").select("*").order("start_date");
  if (error) throw new Error(error.message);
  return (data || []).map(mapPeriod);
}

function mapPeriod(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    startDate: r.start_date,
    endDate: r.end_date || null,
    isCurrent: r.is_current === true,
    notes: r.notes || "",
  };
}

async function getEmploymentPeriods(employeeId) {
  requireSupabase();
  const { data, error } = await db()
    .from("employment_periods")
    .select("*")
    .eq("employee_id", employeeId)
    .order("start_date");
  if (error) throw new Error(error.message);
  return (data || []).map(mapPeriod);
}

async function addEmploymentPeriod(employeeId, { startDate, endDate, notes }, actor) {
  requireSupabase();
  await db().from("employment_periods").update({ is_current: false }).eq("employee_id", employeeId);
  const row = {
    employee_id: employeeId,
    start_date: startDate,
    end_date: endDate || null,
    is_current: true,
    notes: notes || "",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("employment_periods").insert(row).select().single();
  if (error) throw new Error(error.message);
  await db().from("employees").update({
    employment_date: startDate,
    depart_date: endDate || null,
    status: endDate ? "Out" : "Active",
    updated_at: new Date().toISOString(),
  }).eq("id", employeeId);
  return mapPeriod(data);
}

async function closeEmploymentPeriod(employeeId, departDate, actor) {
  requireSupabase();
  let periods = await getEmploymentPeriods(employeeId);
  let current = periods.find((p) => p.isCurrent) || periods[periods.length - 1];
  if (!current) {
    const store = require("./data-store");
    const emp = store.getEmployeeById(employeeId);
    const startDate = emp?.employment_date || departDate;
    current = await insertEmploymentPeriodRecord(
      employeeId,
      { startDate, endDate: null, notes: "Auto-created for depart" },
      actor || "system"
    );
  }
  const { error } = await db()
    .from("employment_periods")
    .update({ end_date: departDate, is_current: false, updated_at: new Date().toISOString() })
    .eq("id", current.id);
  if (error) throw new Error(error.message);
  await db().from("employees").update({
    depart_date: departDate,
    updated_at: new Date().toISOString(),
  }).eq("id", employeeId);
  return { ok: true, departDate };
}

const ORG_UNITS = ["HS-1", "HS-2", "HS-3", "HS-MGMT"];

function mapOrgTeam(r) {
  return {
    id: r.id,
    name: r.name,
    unit: r.unit || "HS-1",
    displayOrder: Number(r.display_order) || 0,
    dialsSales: r.dials_sales !== false,
  };
}

async function readOrgTeams() {
  requireSupabase();
  const { data, error } = await db().from("org_teams").select("*").order("display_order").order("name");
  if (error) throw new Error(error.message);
  return (data || []).map(mapOrgTeam);
}

async function createOrgTeam({ name, unit, dialsSales, displayOrder }, actor) {
  requireSupabase();
  const row = {
    name: String(name || "").trim(),
    unit: unit || "HS-1",
    dials_sales: dialsSales !== false,
    display_order: Number(displayOrder) || 0,
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error("Team name required");
  const { data, error } = await db().from("org_teams").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapOrgTeam(data);
}

async function updateOrgTeam(id, patch, actor) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  if (patch.name) row.name = String(patch.name).trim();
  if (patch.unit) row.unit = patch.unit;
  if (patch.dialsSales !== undefined) row.dials_sales = Boolean(patch.dialsSales);
  if (patch.displayOrder != null) row.display_order = Number(patch.displayOrder);
  const { data, error } = await db().from("org_teams").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapOrgTeam(data);
}

async function buildOrgByUnits(companyContext = "hangup") {
  const store = require("./data-store");
  const idGen = require("./id-generator");
  const companyCtx = require("./company-context");
  let teamsMeta = [];
  try {
    teamsMeta = await readOrgTeams();
  } catch {
    teamsMeta = [];
  }
  const teamMetaMap = new Map(teamsMeta.map((t) => [t.name, t]));
  let employees = store.getEmployees({ hideOut: false }).filter((e) => !idGen.isOutEmployee(e));
  employees = companyCtx.filterEmployeesByCompany(employees, companyContext);

  const units = {};
  for (const u of ORG_UNITS) units[u] = [];

  const teamNames = new Set([...teamsMeta.map((t) => t.name), ...employees.map((e) => e.team).filter(Boolean)]);
  for (const name of [...teamNames].sort()) {
    const meta = teamMetaMap.get(name) || { name, unit: "HS-1", dialsSales: true, displayOrder: 999 };
    const unit = meta.unit || "HS-1";
    if (!units[unit]) units[unit] = [];
    const agents = employees
      .filter((e) => e.team === name)
      .map((e) => ({
        id: e.id,
        name: e.american_name || e.arabic_name || e.id,
        position: e.position || "",
        unit: e.unit || "",
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    units[unit].push({
      name,
      unit,
      dialsSales: meta.dialsSales !== false,
      displayOrder: meta.displayOrder ?? 999,
      id: meta.id || null,
      agents,
    });
  }

  for (const u of ORG_UNITS) {
    units[u].sort((a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999) || a.name.localeCompare(b.name));
  }

  const unassigned = employees
    .filter((e) => !e.team)
    .map((e) => ({
      id: e.id,
      name: e.american_name || e.arabic_name || e.id,
      position: e.position || "",
      unit: e.unit || "",
    }));

  return { units: ORG_UNITS.map((unit) => ({ unit, teams: units[unit] || [] })), unassigned, orgUnits: ORG_UNITS };
}

async function readAllActionPlans() {
  requireSupabase();
  const { data, error } = await db().from("action_improvement_plans").select("*").order("week_start", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(mapAip);
}

async function getActionPlans(employeeId) {
  requireSupabase();
  const { data, error } = await db()
    .from("action_improvement_plans")
    .select("*")
    .eq("employee_id", employeeId)
    .order("week_start", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(mapAip);
}

function mapAip(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    weekStart: r.week_start,
    weekEnd: r.week_end,
    status: r.status || "active",
    notes: r.notes || "",
    createdBy: r.created_by || "",
    createdAt: r.created_at,
  };
}

async function createActionPlan({ employeeId, weekStart, weekEnd, notes }, actor) {
  requireSupabase();
  const row = {
    employee_id: employeeId,
    week_start: weekStart,
    week_end: weekEnd,
    status: "active",
    notes: notes || "",
    created_by: actor,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("action_improvement_plans").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapAip(data);
}

async function cancelActionPlan(id, actor) {
  requireSupabase();
  const { data, error } = await db()
    .from("action_improvement_plans")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapAip(data);
}

async function getOnboarding(employeeId) {
  requireSupabase();
  const { data, error } = await db().from("onboarding_checklists").select("*").eq("employee_id", employeeId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapOnboarding(data) : defaultOnboarding(employeeId);
}

function defaultOnboarding(employeeId) {
  return {
    employeeId,
    adUser: false,
    idScanned: false,
    contract: false,
    trainingPhase1: false,
    trainingPhase2: false,
    trainingPhase3: false,
    trainingPhase4: false,
  };
}

function mapOnboarding(r) {
  return {
    employeeId: r.employee_id,
    adUser: r.ad_user === true,
    idScanned: r.id_scanned === true,
    contract: r.contract === true,
    trainingPhase1: r.training_phase_1 === true,
    trainingPhase2: r.training_phase_2 === true,
    trainingPhase3: r.training_phase_3 === true,
    trainingPhase4: r.training_phase_4 === true,
  };
}

async function saveOnboarding(employeeId, patch, actor) {
  requireSupabase();
  const row = {
    employee_id: employeeId,
    ad_user: patch.adUser === true,
    id_scanned: patch.idScanned === true,
    contract: patch.contract === true,
    training_phase_1: patch.trainingPhase1 === true,
    training_phase_2: patch.trainingPhase2 === true,
    training_phase_3: patch.trainingPhase3 === true,
    training_phase_4: patch.trainingPhase4 === true,
    updated_by: actor,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("onboarding_checklists").upsert(row).select().single();
  if (error) throw new Error(error.message);
  return mapOnboarding(data);
}

async function getOffboarding(employeeId) {
  requireSupabase();
  const { data, error } = await db().from("offboarding_checklists").select("*").eq("employee_id", employeeId).maybeSingle();
  if (error) throw new Error(error.message);
  return data
    ? { employeeId, revokeAccess: data.revoke_access === true, finalPay: data.final_pay === true }
    : { employeeId, revokeAccess: false, finalPay: false };
}

async function saveOffboarding(employeeId, patch, actor) {
  requireSupabase();
  const row = {
    employee_id: employeeId,
    revoke_access: patch.revokeAccess === true,
    final_pay: patch.finalPay === true,
    updated_by: actor,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("offboarding_checklists").upsert(row).select().single();
  if (error) throw new Error(error.message);
  return { employeeId, revokeAccess: data.revoke_access, finalPay: data.final_pay };
}

async function getClearanceItems(employeeId) {
  requireSupabase();
  const { data, error } = await db().from("clearance_items").select("*").eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
  const items = (data || []).map(mapClearance);
  for (const key of CLEARANCE_KEYS) {
    if (!items.find((i) => i.itemKey === key)) {
      items.push({ employeeId, itemKey: key, status: "pending", notes: "" });
    }
  }
  return items;
}

function mapClearance(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    itemKey: r.item_key,
    status: r.status || "pending",
    notes: r.notes || "",
  };
}

async function saveClearanceItem(employeeId, itemKey, status, notes, actor) {
  requireSupabase();
  const row = {
    employee_id: employeeId,
    item_key: itemKey,
    status,
    notes: notes || "",
    updated_by: actor,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("clearance_items").upsert(row, { onConflict: "employee_id,item_key" }).select().single();
  if (error) throw new Error(error.message);
  return mapClearance(data);
}

async function readAllEquipment() {
  requireSupabase();
  const { data, error } = await db().from("equipment").select("*").order("asset_tag");
  if (error) throw new Error(error.message);
  return (data || []).map(mapEquipment);
}

function mapEquipment(r) {
  return {
    id: r.id,
    assetTag: r.asset_tag,
    unit: r.unit || "",
    itemType: r.item_type || "",
    description: r.description || "",
    notes: r.notes || "",
  };
}

async function readEquipmentAssignments(employeeId = null) {
  requireSupabase();
  let q = db().from("equipment_assignments").select("*, equipment(*)");
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q.order("assigned_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(mapAssignment);
}

function mapAssignment(r) {
  const eq = r.equipment || {};
  return {
    id: r.id,
    equipmentId: r.equipment_id,
    employeeId: r.employee_id,
    assignedAt: r.assigned_at,
    returnedAt: r.returned_at || null,
    notes: r.notes || "",
    assetTag: eq.asset_tag || "",
    description: eq.description || "",
    itemType: eq.item_type || "",
    unit: eq.unit || "",
  };
}

async function createEquipment({ assetTag, unit, itemType, description, notes, employeeId }, actor) {
  requireSupabase();
  const store = require("./data-store");
  let tag = String(assetTag || "").trim();
  let unitVal = unit || "";
  if (employeeId) {
    const emp = store.getEmployeeById(employeeId);
    if (!emp) throw new Error("Employee not found");
    unitVal = emp.unit || unitVal;
    if (!tag) {
      const all = await readAllEquipment();
      const typeKey = String(itemType || "item").replace(/\s+/g, "");
      const seq = all.filter((e) => e.itemType === itemType).length + 1;
      tag = `${employeeId}-${typeKey}-${seq}`;
    }
  }
  if (!tag) throw new Error("Could not generate asset tag");
  const row = {
    asset_tag: tag,
    unit: unitVal,
    item_type: itemType || "",
    description: description || "",
    notes: notes || "",
    created_by: actor,
  };
  const { data, error } = await db().from("equipment").insert(row).select().single();
  if (error) throw new Error(error.message);
  const equipment = mapEquipment(data);
  if (employeeId) {
    await assignEquipment(equipment.id, employeeId, actor);
  }
  return equipment;
}

async function insertEmploymentPeriodRecord(employeeId, { startDate, endDate, notes }, actor) {
  requireSupabase();
  const row = {
    employee_id: employeeId,
    start_date: startDate,
    end_date: endDate || null,
    is_current: !endDate,
    notes: notes || "",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("employment_periods").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapPeriod(data);
}

function buildLiveOrgStructure() {
  const store = require("./data-store");
  const idGen = require("./id-generator");
  const employees = store.getEmployees({ hideOut: false });
  const byTeam = new Map();
  for (const e of employees) {
    if (idGen.isOutEmployee(e)) continue;
    const team = e.team || "Unassigned";
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push({
      id: e.id,
      name: e.american_name || e.arabic_name || e.id,
      position: e.position || "",
      unit: e.unit || "",
    });
  }
  const structure = {};
  for (const [team, agents] of [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    structure[team] = {
      label: team,
      reportsTo: "—",
      agents: agents.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })),
    };
  }
  return structure;
}

async function assignEquipment(equipmentId, employeeId, actor) {
  requireSupabase();
  const { data: openRows, error: qErr } = await db()
    .from("equipment_assignments")
    .select("id, equipment_id, employee_id")
    .is("returned_at", null);
  if (qErr) throw new Error(qErr.message);
  const open = openRows || [];
  if (open.some((r) => r.equipment_id === equipmentId)) {
    throw new Error("This equipment already has an open assignment");
  }
  if (open.some((r) => r.employee_id === employeeId && r.equipment_id === equipmentId)) {
    throw new Error("This employee already has an open assignment for this equipment");
  }
  const row = {
    equipment_id: equipmentId,
    employee_id: employeeId,
    assigned_by: actor,
    assigned_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("equipment_assignments").insert(row).select("*, equipment(*)").single();
  if (error) throw new Error(error.message);
  return mapAssignment(data);
}

async function updateEquipment(id, patch, actor) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  const fields = {
    assetTag: "asset_tag",
    unit: "unit",
    itemType: "item_type",
    description: "description",
    notes: "notes",
  };
  for (const [k, col] of Object.entries(fields)) {
    if (patch[k] !== undefined) row[col] = patch[k];
  }
  const { data, error } = await db().from("equipment").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapEquipment(data);
}

async function returnEquipment(assignmentId, actor) {
  requireSupabase();
  const { data, error } = await db()
    .from("equipment_assignments")
    .update({ returned_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .select("*, equipment(*)")
    .single();
  if (error) throw new Error(error.message);
  return mapAssignment(data);
}

async function readLeaveRequests(filters = {}) {
  requireSupabase();
  let q = db().from("leave_requests").select("*").order("created_at", { ascending: false });
  if (filters.employeeId) q = q.eq("employee_id", filters.employeeId);
  if (filters.status) q = q.eq("status", filters.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(mapLeave);
}

function mapLeave(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    startDate: r.start_date,
    endDate: r.end_date,
    leaveType: r.leave_type || "annual",
    requestKind: r.request_kind || r.leave_type || "annual",
    status: r.status || "pending",
    approvedBy: r.approved_by || "",
    notes: r.notes || "",
    createdBy: r.created_by || "",
    createdAt: r.created_at,
    paidLeave: r.paid_leave === true,
    lateSubmission: r.late_submission === true,
    requestedBy: r.requested_by || "",
    requestedByRole: r.requested_by_role || "",
  };
}

async function createLeaveRequest(payload, actor) {
  requireSupabase();
  const row = {
    employee_id: payload.employeeId,
    start_date: payload.startDate,
    end_date: payload.endDate,
    leave_type: payload.leaveType || payload.requestKind || "annual",
    request_kind: payload.requestKind || payload.leaveType || "annual",
    status: "pending",
    notes: payload.notes || "",
    created_by: actor,
    requested_by: payload.requestedBy || actor,
    requested_by_role: payload.requestedByRole || "",
    paid_leave: payload.paidLeave === true,
    late_submission: payload.lateSubmission === true,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("leave_requests").insert(row).select().single();
  if (error) throw new Error(error.message);
  return mapLeave(data);
}

async function updateLeaveRequest(id, patch, actor) {
  requireSupabase();
  const row = { updated_at: new Date().toISOString() };
  if (patch.status) row.status = patch.status;
  if (patch.status === "approved") row.approved_by = actor;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.startDate) row.start_date = patch.startDate;
  if (patch.endDate) row.end_date = patch.endDate;
  if (patch.paidLeave !== undefined) row.paid_leave = Boolean(patch.paidLeave);
  const { data, error } = await db().from("leave_requests").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return mapLeave(data);
}

async function deleteLeaveRequest(id) {
  requireSupabase();
  const { error } = await db().from("leave_requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function readPublicHolidays({ activeOnly = false } = {}) {
  requireSupabase();
  let q = db().from("public_holidays").select("*").order("holiday_date");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id,
    date: r.holiday_date,
    name: r.name,
    country: r.country || "USA",
    active: r.active !== false,
  }));
}

async function updatePublicHoliday(id, patch) {
  requireSupabase();
  const row = {};
  if (patch.active !== undefined) row.active = Boolean(patch.active);
  if (patch.name) row.name = patch.name;
  const { data, error } = await db().from("public_holidays").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id, date: data.holiday_date, name: data.name, country: data.country, active: data.active !== false };
}

async function seedPublicHolidays(rows, actor) {
  requireSupabase();
  if (!rows?.length) return { count: 0 };
  const payload = rows.map((r) => ({
    holiday_date: r.date,
    name: r.name,
    country: r.country || "USA",
    active: r.active !== false,
  }));
  const { error } = await db().from("public_holidays").upsert(payload, { onConflict: "holiday_date" });
  if (error) throw new Error(error.message);
  return { count: payload.length };
}

async function upsertPublicHoliday({ date, name, country }, actor) {
  requireSupabase();
  const row = { holiday_date: date, name, country: country || "USA" };
  const { data, error } = await db().from("public_holidays").upsert(row, { onConflict: "holiday_date" }).select().single();
  if (error) throw new Error(error.message);
  return { id: data.id, date: data.holiday_date, name: data.name, country: data.country };
}

async function deletePublicHoliday(id) {
  requireSupabase();
  const { error } = await db().from("public_holidays").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function getPayrollMonthLock(yearMonth) {
  requireSupabase();
  const { data, error } = await db().from("payroll_month_locks").select("*").eq("year_month", yearMonth).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { yearMonth: data.year_month, lockedAt: data.locked_at, lockedBy: data.locked_by, notes: data.notes } : null;
}

async function setPayrollMonthLock(yearMonth, locked, actor, notes = "") {
  requireSupabase();
  if (!locked) {
    const { error } = await db().from("payroll_month_locks").delete().eq("year_month", yearMonth);
    if (error) throw new Error(error.message);
    return { locked: false };
  }
  const row = { year_month: yearMonth, locked_by: actor, notes, locked_at: new Date().toISOString() };
  const { data, error } = await db().from("payroll_month_locks").upsert(row).select().single();
  if (error) throw new Error(error.message);
  return { locked: true, yearMonth: data.year_month, lockedBy: data.locked_by };
}

async function readAllPayrollLocks() {
  requireSupabase();
  const { data, error } = await db().from("payroll_month_locks").select("*");
  if (error) throw new Error(error.message);
  return data || [];
}

async function upsertAppSession(session) {
  if (!useSupabase()) return;
  const row = {
    id: session.id,
    username: session.username,
    device_label: session.deviceLabel || "Desktop",
    ip: session.ip || null,
    last_seen_at: new Date().toISOString(),
  };
  await db().from("app_sessions").upsert(row, { onConflict: "id" });
}

async function touchAppSession(id) {
  if (!useSupabase()) return;
  await db().from("app_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
}

async function revokeAppSession(id) {
  requireSupabase();
  const { error } = await db().from("app_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function listAppSessions() {
  requireSupabase();
  const { data, error } = await db().from("app_sessions").select("*").is("revoked_at", null).order("last_seen_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: r.id,
    username: r.username,
    deviceLabel: r.device_label || "",
    ip: r.ip || "",
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  }));
}

async function isSessionRevoked(id) {
  if (!useSupabase()) return false;
  const { data } = await db().from("app_sessions").select("revoked_at").eq("id", id).maybeSingle();
  return Boolean(data?.revoked_at);
}

function getOrgStructure() {
  return ORG_STRUCTURE;
}

async function getLiveOrgStructure(companyContext = "hangup") {
  return buildOrgByUnits(companyContext);
}

module.exports = {
  CLEARANCE_KEYS,
  ORG_STRUCTURE,
  readAllEmploymentPeriods,
  getEmploymentPeriods,
  addEmploymentPeriod,
  closeEmploymentPeriod,
  readAllActionPlans,
  getActionPlans,
  createActionPlan,
  cancelActionPlan,
  getOnboarding,
  saveOnboarding,
  getOffboarding,
  saveOffboarding,
  getClearanceItems,
  saveClearanceItem,
  readAllEquipment,
  createEquipment,
  updateEquipment,
  readEquipmentAssignments,
  assignEquipment,
  returnEquipment,
  insertEmploymentPeriodRecord,
  readLeaveRequests,
  createLeaveRequest,
  updateLeaveRequest,
  deleteLeaveRequest,
  readPublicHolidays,
  upsertPublicHoliday,
  updatePublicHoliday,
  seedPublicHolidays,
  deletePublicHoliday,
  getPayrollMonthLock,
  setPayrollMonthLock,
  readAllPayrollLocks,
  upsertAppSession,
  touchAppSession,
  revokeAppSession,
  listAppSessions,
  isSessionRevoked,
  getOrgStructure,
  getLiveOrgStructure,
  buildLiveOrgStructure,
  readOrgTeams,
  createOrgTeam,
  updateOrgTeam,
  buildOrgByUnits,
  ORG_UNITS,
};
