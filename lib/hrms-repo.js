/**
 * Supabase CRUD for HRMS advanced tables.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const companyContext = require("./company-context");
const equipmentClearance = require("./equipment-clearance");

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

async function reopenEmploymentPeriod(employeeId, actor) {
  requireSupabase();
  const periods = await getEmploymentPeriods(employeeId);
  const closed = periods
    .filter((p) => p.endDate)
    .sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));
  if (!closed.length) return { ok: false, reason: "no_closed_period" };

  const latest = closed[0];
  await db()
    .from("employment_periods")
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .eq("employee_id", employeeId);
  const { error } = await db()
    .from("employment_periods")
    .update({
      end_date: null,
      is_current: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", latest.id);
  if (error) throw new Error(error.message);
  return { ok: true, periodId: latest.id };
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
  const patch = {
    depart_date: departDate,
    updated_at: new Date().toISOString(),
  };
  if (departDate <= require("./date-iso").todayLocalIsoDate()) {
    patch.status = "Out";
  }
  await db().from("employees").update(patch).eq("id", employeeId);
  return { ok: true, departDate };
}

const ORG_UNITS = ["HS-1", "HS-2", "HS-3", "HS-Back-End", "HS-MGMT"];

let cachedOrgUnits = null;
let cachedOrgUnitsAt = 0;
const ORG_UNITS_TTL_MS = 60 * 1000;

async function readOrgUnits() {
  requireSupabase();
  const now = Date.now();
  if (cachedOrgUnits && now - cachedOrgUnitsAt < ORG_UNITS_TTL_MS) return cachedOrgUnits;
  const { data, error } = await db().from("org_units").select("*").order("display_order").order("name");
  if (error) throw new Error(error.message);
  cachedOrgUnits = (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    companySlug: r.company_slug || "hangup",
    displayOrder: Number(r.display_order) || 0,
    hasOp: r.has_op !== false,
    label: r.label || r.name,
  }));
  cachedOrgUnitsAt = now;
  return cachedOrgUnits;
}

async function createOrgUnit({ name, companySlug, displayOrder, hasOp, label }, actor) {
  requireSupabase();
  const row = {
    name: String(name || "").trim(),
    company_slug: String(companySlug || "hangup").trim() || "hangup",
    display_order: Number(displayOrder) || 0,
    has_op: hasOp !== false,
    label: label || name,
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error("Unit name required");
  const { data, error } = await db().from("org_units").insert(row).select().single();
  if (error) throw new Error(error.message);
  cachedOrgUnits = null;
  return { id: data.id, name: data.name, companySlug: data.company_slug, displayOrder: data.display_order, hasOp: data.has_op, label: data.label };
}

async function deleteOrgUnit(unitName, actor) {
  requireSupabase();
  const store = require("./data-store");
  const unit = String(unitName || "").trim();
  if (!unit) throw new Error("Unit name required");

  const employees = store.getEmployees({ hideOut: false });
  const onUnit = employees.filter((e) => String(e.unit || "").trim() === unit);
  const clearedEmployeeIds = [];

  for (const emp of onUnit) {
    await store.updateEmployee(emp.id, { unit: "" }, actor);
    clearedEmployeeIds.push(emp.id);
  }

  const teams = await readOrgTeams();
  const teamsInUnit = teams.filter((t) => String(t.unit || "").trim() === unit);
  for (const team of teamsInUnit) {
    await deleteOrgTeam(team.id, actor);
  }

  const { error: mgrErr } = await db().from("org_unit_managers").delete().eq("unit", unit);
  if (mgrErr) throw new Error(mgrErr.message);

  const { error: unitErr } = await db().from("org_units").delete().eq("name", unit);
  if (unitErr) throw new Error(unitErr.message);

  cachedOrgUnits = null;
  return { deletedUnit: unit, clearedEmployeeIds, deletedTeams: teamsInUnit.map((t) => t.name) };
}

function mapOrgUnit(r) {
  return {
    id: r.id,
    name: r.name,
    companySlug: r.company_slug || "hangup",
    displayOrder: Number(r.display_order) || 0,
    hasOp: r.has_op !== false,
    label: r.label || r.name,
  };
}

function mapOrgTeam(r) {
  return {
    id: r.id,
    name: r.name,
    unit: r.unit || "HS-1",
    displayOrder: Number(r.display_order) || 0,
    dialsSales: r.dials_sales !== false,
    tlEmployeeId: r.tl_employee_id || "",
    tlEmployeeIds: r._tlEmployeeIds || [],
    closerEmployeeIds: r._closerEmployeeIds || [],
  };
}

async function readOrgTeams() {
  requireSupabase();
  const [teamsData, teamTlsData, teamClosersData] = await Promise.all([
    db().from("org_teams").select("*").order("display_order").order("name"),
    db().from("team_tls").select("*"),
    db().from("team_closers").select("*").then((r) => r).catch(() => ({ data: [], error: null })),
  ]);
  if (teamsData.error) throw new Error(teamsData.error.message);
  const tlsByTeam = {};
  if (teamTlsData.data && !teamTlsData.error) {
    for (const r of teamTlsData.data || []) {
      if (!tlsByTeam[r.team_id]) tlsByTeam[r.team_id] = [];
      tlsByTeam[r.team_id].push(r.employee_id);
    }
  }
  const closersByTeam = {};
  if (teamClosersData.data && !teamClosersData.error) {
    for (const r of teamClosersData.data || []) {
      if (!closersByTeam[r.team_id]) closersByTeam[r.team_id] = [];
      closersByTeam[r.team_id].push(r.employee_id);
    }
  }
  return (teamsData.data || []).map((r) => {
    const ids = tlsByTeam[r.id] || [];
    if (r.tl_employee_id && !ids.includes(r.tl_employee_id)) {
      ids.unshift(r.tl_employee_id);
    }
    return mapOrgTeam({
      ...r,
      _tlEmployeeIds: ids,
      _closerEmployeeIds: closersByTeam[r.id] || [],
    });
  });
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
  if (patch.tlEmployeeId !== undefined) row.tl_employee_id = patch.tlEmployeeId || null;
  const { data, error } = await db().from("org_teams").update(row).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  if (patch.tlEmployeeId !== undefined) {
    try {
      require("./roles").invalidateOrgTeamsCache();
    } catch {
      /* optional */
    }
    const store = require("./data-store");
    const prevTlId = data.tl_employee_id || "";
    const nextTlId = patch.tlEmployeeId ? String(patch.tlEmployeeId).trim() : "";
    const teamTls = require("./team-tls-repo");
    if (nextTlId) {
      const emp = store.getEmployeeById(nextTlId);
      if (emp) {
        await store.updateEmployee(
          nextTlId,
          {
            lead_role: "TL",
            team: data.name,
            unit: data.unit,
            position: emp.position || "Team Leader",
          },
          actor || "system"
        );
      }
      if (prevTlId && prevTlId !== nextTlId) {
        await teamTls.addTeamTl(id, nextTlId).catch(() => {});
      }
    } else if (prevTlId) {
      await teamTls.removeTeamTl(id, prevTlId).catch(() => {});
    }
  }
  return mapOrgTeam(data);
}

/**
 * Move team to a new unit and optionally reassign dialing-agent IDs for that unit's prefix.
 */
async function relocateTeamToUnit(teamId, newUnit, { reassignIds = true, username, dialsSales } = {}) {
  requireSupabase();
  const store = require("./data-store");
  const idGen = require("./id-generator");
  const { isDialingAgent } = require("./dialing-agents");
  const { teamsMatch } = require("./team-names");
  const { UNIT_ID_RULES } = idGen;
  const { BACKEND_UNIT, MGMT_UNIT } = require("./org-hierarchy");

  const teams = await readOrgTeams();
  const team = teams.find((t) => t.id === teamId);
  if (!team) throw new Error("Team not found");
  if (!newUnit) throw new Error("newUnit required");

  const isBackendUnit = newUnit === BACKEND_UNIT || newUnit === MGMT_UNIT;
  const patch = { unit: newUnit, name: team.name };
  if (dialsSales !== undefined) patch.dialsSales = Boolean(dialsSales);
  else if (isBackendUnit && team.dialsSales !== false) patch.dialsSales = false;

  await updateOrgTeam(teamId, patch, username);

  const employees = store.getEmployees({ hideOut: false });
  const onTeam = employees.filter((e) => teamsMatch(e.team, team.name));
  const rule = UNIT_ID_RULES[newUnit];
  const changes = [];
  const skipped = [];

  for (const emp of onTeam) {
    let targetId = emp.id;

    if (reassignIds && rule && isDialingAgent(emp, { includeOut: true, activeOnly: false })) {
      const needsNew =
        !String(emp.id || "").toUpperCase().startsWith(rule.prefix.toUpperCase()) || emp.unit !== newUnit;
      if (needsNew) {
        const all = store.getEmployees({ hideOut: false, includeDeleted: true });
        const nextId = idGen.allocateNextAvailableId(all, newUnit);
        await store.changeEmployeeAppId(emp.id, nextId, username);
        targetId = nextId;
      }
    } else if (reassignIds) {
      if (!rule) skipped.push({ id: emp.id, reason: "no_id_rule_for_unit" });
      else if (!isDialingAgent(emp, { includeOut: true, activeOnly: false })) {
        skipped.push({ id: emp.id, reason: "not_dialing_agent" });
      }
    }

    await store.updateEmployee(targetId, { unit: newUnit, team: team.name }, username);
    changes.push({ from: emp.id, to: targetId, unit: newUnit });
  }

  return { team: { ...team, unit: newUnit }, changes, skipped };
}

async function deleteOrgTeam(teamId, username) {
  requireSupabase();
  const store = require("./data-store");
  const { teamsMatch } = require("./team-names");

  const teams = await readOrgTeams();
  const team = teams.find((t) => t.id === teamId);
  if (!team) throw new Error("Team not found");

  const employees = store.getEmployees({ hideOut: false });
  const onTeam = employees.filter((e) => teamsMatch(e.team, team.name));
  const cleared = [];

  for (const emp of onTeam) {
    await store.updateEmployee(emp.id, { team: "" }, username);
    cleared.push(emp.id);
  }

  const { error } = await db().from("org_teams").delete().eq("id", teamId);
  if (error) throw new Error(error.message);

  return { deletedTeam: team.name, clearedEmployeeIds: cleared };
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
  const { teamsMatch } = require("./team-names");
  let employees = store.getEmployees({ hideOut: false }).filter((e) => !idGen.isOutEmployee(e));
  employees = companyCtx.filterEmployeesByCompany(employees, companyContext);

  let orgUnits = [];
  try {
    orgUnits = await readOrgUnits();
  } catch {
    orgUnits = [];
  }
  const units = {};
  for (const u of orgUnits) {
    if (String(u.companySlug || "").toLowerCase() !== String(companyContext || "").toLowerCase()) continue;
    units[u.name] = [];
  }

  for (const meta of teamsMeta) {
    const name = meta.name;
    if (!name) continue;
    const unit = meta.unit || "HS-1";
    const unitCompany = companyCtx.getCompanyForUnit(unit);
    if (String(unitCompany || "").toLowerCase() !== String(companyContext || "").toLowerCase()) continue;
    if (!units[unit]) units[unit] = [];
    const agents = employees
      .filter((e) => teamsMatch(e.team, name))
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

  const sortedUnits = Object.keys(units).sort((a, b) => {
    const ua = orgUnits.find((u) => u.name === a);
    const ub = orgUnits.find((u) => u.name === b);
    return (ua?.displayOrder ?? 999) - (ub?.displayOrder ?? 999) || a.localeCompare(b);
  });

  for (const u of sortedUnits) {
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

  return { units: sortedUnits.map((unit) => ({ unit, teams: units[unit] || [] })), unassigned, orgUnits: sortedUnits };
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

async function getActionPlan(id) {
  requireSupabase();
  const { data, error } = await db()
    .from("action_improvement_plans")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapAip(data) : null;
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

async function saveClearanceItem(employeeId, itemKey, status, notes, actor, opts = {}) {
  requireSupabase();
  if (itemKey === "equipment_handover" && status === "done" && !opts.skipDeviceGuard) {
    const open = equipmentClearance.unreturnedAssignments(await readEquipmentAssignments(employeeId));
    if (open.length) {
      throw new Error("Cannot mark equipment handover done while devices are still out");
    }
  }
  let notesVal = notes;
  if (notesVal === undefined) {
    const existing = await getClearanceItems(employeeId);
    const found = existing.find((i) => i.itemKey === itemKey);
    notesVal = found?.notes || "";
  }
  const row = {
    employee_id: employeeId,
    item_key: itemKey,
    status,
    notes: notesVal || "",
    updated_by: actor,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("clearance_items").upsert(row, { onConflict: "employee_id,item_key" }).select().single();
  if (error) throw new Error(error.message);
  return mapClearance(data);
}

async function readAllEquipment(company) {
  requireSupabase();
  let q = db().from("equipment").select("*").order("asset_tag");
  if (company) q = q.eq("company", company);
  const { data, error } = await q;
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
    company: equipmentClearance.coalesceCompany(r.company),
  };
}

async function fetchAssignmentPages(buildQuery) {
  const PAGE = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function readEquipmentAssignments(employeeId = null, company = null) {
  requireSupabase();
  const ids = Array.isArray(employeeId) ? employeeId.filter(Boolean) : employeeId ? [employeeId] : null;
  const rows = await fetchAssignmentPages(() => {
    let q = db()
      .from("equipment_assignments")
      .select("*, equipment(*)")
      .order("assigned_at", { ascending: false });
    if (ids && ids.length === 1) q = q.eq("employee_id", ids[0]);
    else if (ids && ids.length > 1) q = q.in("employee_id", ids);
    return q;
  });
  let mapped = rows.map(mapAssignment);
  if (company) {
    const want = equipmentClearance.coalesceCompany(company);
    mapped = mapped.filter((a) => equipmentClearance.coalesceCompany(a.company) === want);
  }
  return mapped;
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
    company: equipmentClearance.coalesceCompany(eq.company),
  };
}

async function hasOpenEquipmentAssignment(employeeIds) {
  requireSupabase();
  const ids = [...new Set((Array.isArray(employeeIds) ? employeeIds : [employeeIds]).filter(Boolean).map(String))];
  if (!ids.length) return false;
  const { data, error } = await db()
    .from("equipment_assignments")
    .select("id")
    .in("employee_id", ids)
    .is("returned_at", null)
    .limit(1);
  if (error) throw new Error(error.message);
  return Boolean(data && data.length);
}

async function syncEquipmentHandover(employeeId, actor) {
  if (!employeeId) return null;
  const assignments = await readEquipmentAssignments(employeeId);
  const status = equipmentClearance.deriveEquipmentHandover(assignments);
  return saveClearanceItem(employeeId, "equipment_handover", status, undefined, actor || "system", {
    skipDeviceGuard: true,
  });
}

async function fetchInChunks(table, column, ids, select, apply = (q) => q) {
  const out = [];
  for (const slice of equipmentClearance.chunkIds(ids, 100)) {
    const { data, error } = await apply(db().from(table).select(select).in(column, slice));
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}

async function buildClearanceBoard(leavers) {
  requireSupabase();
  const list = Array.isArray(leavers) ? leavers : [];
  if (!list.length) return [];

  const idToEmp = new Map();
  const allLookupIds = [];
  for (const emp of list) {
    const lookup = equipmentClearance.employeeEquipmentLookupIds(emp);
    for (const lid of lookup) {
      idToEmp.set(lid, emp);
      allLookupIds.push(lid);
    }
  }
  const currentIds = list.map((e) => e.id).filter(Boolean);

  const [assignmentRows, offboardingRows, clearanceRows, documentRows] = await Promise.all([
    fetchInChunks("equipment_assignments", "employee_id", allLookupIds, "*, equipment(*)"),
    fetchInChunks("offboarding_checklists", "employee_id", currentIds, "*"),
    fetchInChunks("clearance_items", "employee_id", currentIds, "*"),
    fetchInChunks("employee_documents", "employee_id", currentIds, "employee_id, doc_type"),
  ]);

  const assignmentsByEmp = new Map();
  for (const raw of assignmentRows) {
    const mapped = mapAssignment(raw);
    const emp = idToEmp.get(String(mapped.employeeId));
    if (!emp) continue;
    const key = emp.id;
    if (!assignmentsByEmp.has(key)) assignmentsByEmp.set(key, []);
    assignmentsByEmp.get(key).push(mapped);
  }

  const offByEmp = new Map();
  for (const row of offboardingRows) {
    offByEmp.set(row.employee_id, {
      employeeId: row.employee_id,
      revokeAccess: row.revoke_access === true,
      finalPay: row.final_pay === true,
    });
  }

  const clearanceByEmp = new Map();
  for (const row of clearanceRows) {
    const key = row.employee_id;
    if (!clearanceByEmp.has(key)) clearanceByEmp.set(key, []);
    clearanceByEmp.get(key).push(mapClearance(row));
  }

  const docsByEmp = new Map();
  for (const row of documentRows) {
    const key = row.employee_id;
    if (!docsByEmp.has(key)) docsByEmp.set(key, []);
    docsByEmp.get(key).push({ docType: row.doc_type || "", employeeId: key });
  }

  return list.map((emp) => {
    const allAssignments = assignmentsByEmp.get(emp.id) || [];
    const open = equipmentClearance.unreturnedAssignments(allAssignments);
    const handover = equipmentClearance.deriveEquipmentHandover(allAssignments);
    let clearance = clearanceByEmp.get(emp.id) || [];
    for (const key of CLEARANCE_KEYS) {
      if (!clearance.find((i) => i.itemKey === key)) {
        clearance.push({
          employeeId: emp.id,
          itemKey: key,
          status: key === "equipment_handover" ? handover : "pending",
          notes: "",
        });
      }
    }
    clearance = clearance.map((c) =>
      c.itemKey === "equipment_handover" ? { ...c, status: handover } : c
    );
    const offboarding = offByEmp.get(emp.id) || {
      employeeId: emp.id,
      revokeAccess: false,
      finalPay: false,
    };
    const documents = docsByEmp.get(emp.id) || [];
    const docCounts = {};
    for (const d of documents) {
      const t = d.docType || "file";
      docCounts[t] = (docCounts[t] || 0) + 1;
    }
    const gates = equipmentClearance.buildPayrollBlockers({
      offboarding,
      clearance,
      equipment: allAssignments,
    });
    const clearanceComplete = equipmentClearance.isClearanceComplete(clearance, allAssignments);
    const payrollReady = equipmentClearance.isPayrollReady(clearance, allAssignments, offboarding);
    const form = clearance.find((c) => c.itemKey === "clearance_form") || {
      itemKey: "clearance_form",
      status: "pending",
    };
    const files = clearance.find((c) => c.itemKey === "files_handover") || {
      itemKey: "files_handover",
      status: "pending",
    };
    return {
      employeeId: emp.id,
      name: emp.american_name || emp.arabic_name || emp.id,
      arabicName: emp.arabic_name || "",
      status: emp.status || "",
      departDate: emp.depart_date || "",
      noticeType: emp.notice_type || "",
      unit: emp.unit || "",
      team: emp.team || "",
      form,
      files,
      equipmentHandover: handover,
      unreturned: open,
      offboarding,
      documents,
      docCounts,
      clearanceComplete,
      payrollReady,
      blocked: gates.blocked || (isOutNeedFinalPay(emp) && !offboarding.finalPay),
      payslipNotes: gates.payslipNotes,
      blockers: gates.blockers,
    };
  });
}

function isOutNeedFinalPay(emp) {
  const { isOutStatus } = require("./employee-status");
  return isOutStatus(emp?.status);
}

async function createEquipment({ assetTag, unit, itemType, description, notes, employeeId, company }, actor) {
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
  const companyVal =
    String(company || companyContext.getCompanyForUnit(unitVal) || "hangup").toLowerCase() === "hs2"
      ? "hs2"
      : "hangup";
  const row = {
    asset_tag: tag,
    unit: unitVal,
    item_type: itemType || "",
    description: description || "",
    notes: notes || "",
    company: companyVal,
  };
  const { data, error } = await db().from("equipment").insert(row).select().single();
  if (error) throw new Error(error.message);
  const equipment = mapEquipment(data);
  try {
    if (employeeId) {
      await assignEquipment(equipment.id, employeeId, actor);
    }
  } catch (err) {
    await db().from("equipment").delete().eq("id", equipment.id);
    throw err;
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
    .select("id")
    .eq("equipment_id", equipmentId)
    .is("returned_at", null)
    .limit(1);
  if (qErr) throw new Error(qErr.message);
  if (openRows && openRows.length) {
    throw new Error("This equipment already has an open assignment");
  }
  const row = {
    equipment_id: equipmentId,
    employee_id: employeeId,
    assigned_by: actor,
    assigned_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("equipment_assignments").insert(row).select("*, equipment(*)").single();
  if (error) {
    if (equipmentClearance.isUniqueViolation(error)) {
      throw new Error("This equipment already has an open assignment");
    }
    throw new Error(error.message);
  }
  const assignment = mapAssignment(data);
  try {
    await syncEquipmentHandover(employeeId, actor);
  } catch {
    /* handover row is derived on the board even if persist fails */
  }
  return assignment;
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
  const assignment = mapAssignment(data);
  try {
    await syncEquipmentHandover(assignment.employeeId, actor);
  } catch {
    /* handover row is derived on the board even if persist fails */
  }
  return assignment;
}

async function readLeaveRequests(filters = {}) {
  requireSupabase();
  let q = db().from("leave_requests").select("*").order("created_at", { ascending: false });
  if (filters.employeeId) q = q.eq("employee_id", filters.employeeId);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.company) q = q.eq("company", filters.company);
  if (filters.overlapFrom && filters.overlapTo) {
    q = q.lte("start_date", filters.overlapTo).gte("end_date", filters.overlapFrom);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(mapLeave);
}

function mapLeave(r) {
  const frac = r.day_fraction != null ? Number(r.day_fraction) : 1;
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
    dayFraction: frac,
    halfDay: r.half_day === true || frac === 0.5,
    halfDayPart: r.half_day_part || null,
    quarterDay: frac === 0.25,
    company: r.company || null,
  };
}

async function createLeaveRequest(payload, actor) {
  requireSupabase();
  const store = require("./data-store");
  const targetEmp = store.getEmployeeById(payload.employeeId);
  const company = targetEmp ? companyContext.getCompanyForUnit(targetEmp.unit) : "hangup";
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
    day_fraction: payload.dayFraction != null ? Number(payload.dayFraction) : 1,
    half_day: payload.halfDay === true || Number(payload.dayFraction) === 0.5,
    half_day_part: payload.halfDayPart || null,
    company,
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
  if (patch.dayFraction != null) row.day_fraction = Number(patch.dayFraction);
  if (patch.halfDay !== undefined) row.half_day = Boolean(patch.halfDay);
  if (patch.halfDayPart !== undefined) row.half_day_part = patch.halfDayPart || null;
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

async function readHolidayCompanyActiveMap(company) {
  const co = String(company || "hangup").trim().toLowerCase() === "hs2" ? "hs2" : "hangup";
  const { data, error } = await db()
    .from("public_holiday_company_active")
    .select("holiday_id, active")
    .eq("company", co);
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return new Map();
    throw new Error(error.message);
  }
  return new Map((data || []).map((r) => [String(r.holiday_id), r.active === true]));
}

function mapHolidayRow(r, activeByCompany) {
  const id = String(r.id);
  const scopedActive = activeByCompany?.has(id) ? activeByCompany.get(id) : r.active !== false;
  return {
    id: r.id,
    date: String(r.holiday_date || "").slice(0, 10),
    name: r.name,
    country: r.country || "USA",
    active: scopedActive,
    globalActive: r.active !== false,
  };
}

async function readPublicHolidays({ activeOnly = false, country = null, company = null } = {}) {
  requireSupabase();
  let q = db().from("public_holidays").select("*").order("holiday_date");
  if (country) q = q.eq("country", country);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const activeByCompany = company ? await readHolidayCompanyActiveMap(company) : null;
  let rows = (data || []).map((r) => mapHolidayRow(r, activeByCompany));
  if (activeOnly) rows = rows.filter((h) => h.active);
  return rows;
}

async function setHolidayActiveForCompany(holidayId, company, active) {
  const co = String(company || "hangup").trim().toLowerCase() === "hs2" ? "hs2" : "hangup";
  const { error } = await db()
    .from("public_holiday_company_active")
    .upsert(
      {
        holiday_id: holidayId,
        company: co,
        active: Boolean(active),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "holiday_id,company" }
    );
  if (error) throw new Error(error.message);
}

async function updatePublicHoliday(id, patch, company = "hangup") {
  requireSupabase();
  if (patch.active !== undefined) {
    await setHolidayActiveForCompany(id, company, patch.active);
  }
  const row = {};
  if (patch.name) row.name = patch.name;
  if (Object.keys(row).length) {
    const { error } = await db().from("public_holidays").update(row).eq("id", id);
    if (error) throw new Error(error.message);
  }
  const holidays = await readPublicHolidays({ company });
  return holidays.find((h) => String(h.id) === String(id)) || null;
}

async function seedPublicHolidays(rows, actor, company = null) {
  requireSupabase();
  if (!rows?.length) return { count: 0 };
  const payload = rows.map((r) => ({
    holiday_date: r.date,
    name: r.name,
    country: r.country || "USA",
    active: r.active !== false,
  }));
  const { error } = await db().from("public_holidays").upsert(payload, {
    onConflict: "holiday_date,country",
    ignoreDuplicates: false,
  });
  if (error) {
    const { error: e2 } = await db().from("public_holidays").upsert(payload, { onConflict: "holiday_date" });
    if (e2) throw new Error(e2.message);
  }

  const companies = company ? [company] : ["hangup", "hs2"];
  for (const row of rows) {
    const { data: hol } = await db()
      .from("public_holidays")
      .select("id")
      .eq("holiday_date", row.date)
      .eq("country", row.country || "USA")
      .maybeSingle();
    if (!hol?.id) continue;
    for (const co of companies) {
      await setHolidayActiveForCompany(hol.id, co, row.active !== false);
    }
  }
  return { count: payload.length };
}

async function upsertPublicHoliday({ date, name, country }, actor) {
  requireSupabase();
  const row = { holiday_date: date, name, country: country || "USA" };
  let { data, error } = await db()
    .from("public_holidays")
    .upsert(row, { onConflict: "holiday_date,country" })
    .select()
    .single();
  if (error) {
    ({ data, error } = await db()
      .from("public_holidays")
      .upsert(row, { onConflict: "holiday_date" })
      .select()
      .single());
  }
  if (error) throw new Error(error.message);
  return { id: data.id, date: data.holiday_date, name: data.name, country: data.country };
}

async function deletePublicHoliday(id) {
  requireSupabase();
  const { error } = await db().from("public_holidays").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function getPayrollMonthLock(yearMonth, company = "hangup") {
  requireSupabase();
  const co = String(company || "hangup").trim().toLowerCase() === "hs2" ? "hs2" : "hangup";
  const { data, error } = await db()
    .from("payroll_month_locks")
    .select("*")
    .eq("year_month", yearMonth)
    .eq("company", co)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data
    ? {
        yearMonth: data.year_month,
        company: data.company || co,
        lockedAt: data.locked_at,
        lockedBy: data.locked_by,
        notes: data.notes,
      }
    : null;
}

async function setPayrollMonthLock(yearMonth, locked, actor, notes = "", company = "hangup") {
  requireSupabase();
  const co = String(company || "hangup").trim().toLowerCase() === "hs2" ? "hs2" : "hangup";
  if (!locked) {
    const { error } = await db()
      .from("payroll_month_locks")
      .delete()
      .eq("year_month", yearMonth)
      .eq("company", co);
    if (error) throw new Error(error.message);
    return { locked: false, company: co };
  }
  const row = {
    company: co,
    year_month: yearMonth,
    locked_by: actor,
    notes,
    locked_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from("payroll_month_locks")
    .upsert(row, { onConflict: "company,year_month" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { locked: true, company: co, yearMonth: data.year_month, lockedBy: data.locked_by };
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
  if (session.sessionKind) row.session_kind = session.sessionKind;
  if (session.authUserId !== undefined) row.auth_user_id = session.authUserId || null;
  if (session.loginMethod) row.login_method = session.loginMethod;
  const { error } = await db().from("app_sessions").upsert(row, { onConflict: "id" });
  if (error && /session_kind|auth_user_id|login_method/i.test(error.message)) {
    // Migration not applied yet — persist legacy columns only
    await db()
      .from("app_sessions")
      .upsert(
        {
          id: session.id,
          username: session.username,
          device_label: session.deviceLabel || "Desktop",
          ip: session.ip || null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    return;
  }
  if (error) throw new Error(error.message);
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

async function getAppSessionRow(id) {
  if (!useSupabase()) return null;
  const { data, error } = await db().from("app_sessions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function revokeOtherSessionsForUser(username, keepSessionId) {
  if (!useSupabase()) return;
  let q = db()
    .from("app_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("username", username)
    .is("revoked_at", null);
  if (keepSessionId) {
    q = q.neq("id", keepSessionId);
  }
  const { error } = await q;
  if (error) throw new Error(error.message);
}

async function getAppUserPasswordChangedAt(username) {
  if (!useSupabase()) return null;
  const name = String(username || "").trim();
  if (!name) return null;
  let { data, error } = await db()
    .from("app_users")
    .select("password_changed_at")
    .eq("username", name)
    .maybeSingle();
  if (error && /password_changed_at/i.test(error.message)) return null;
  if (error) throw new Error(error.message);
  return data?.password_changed_at || null;
}

function getOrgStructure() {
  return ORG_STRUCTURE;
}

async function getLiveOrgStructure(companyContext = "hangup") {
  return buildOrgByUnits(companyContext);
}

function filterOrgStructureForRole(structure, userRole) {
  const store = require("./data-store");
  const rolesMod = require("./roles");
  const { teamsMatch } = require("./team-names");
  const role = userRole?.role;
  const emp = userRole?.employeeId ? store.getEmployeeById(userRole.employeeId) : null;
  const team = emp?.team || userRole?.team;
  const unit = emp?.unit || userRole?.unit;

  function filterAgentsByAccess(agents) {
    if (!agents?.length) return [];
    return agents.filter((a) => {
      const agentEmp = store.getEmployeeById(a.id);
      return agentEmp && rolesMod.canAccessEmployee(userRole, agentEmp);
    });
  }

  function mapTeamsFiltered(units) {
    return (units || [])
      .map((section) => ({
        ...section,
        teams: (section.teams || [])
          .map((t) => ({ ...t, agents: filterAgentsByAccess(t.agents) }))
          .filter((t) => t.agents.length > 0),
      }))
      .filter((section) => section.teams.length > 0);
  }

  function visibleTeamNames() {
    const names = new Set();
    if (team) names.add(team);
    for (const lt of userRole?.leadTeams || []) {
      if (lt.team) names.add(lt.team);
    }
    return names;
  }

  if (role === "op") {
    if (!unit) return { ...structure, units: [], unassigned: [] };
    const units = mapTeamsFiltered(
      (structure.units || [])
        .filter((u) => u.unit === unit)
        .map((section) => ({ ...section, teams: section.teams || [] }))
    );
    return { ...structure, units, unassigned: [] };
  }

  if (role === "tl") {
    const names = visibleTeamNames();
    if (!names.size) {
      const unassigned = filterAgentsByAccess(
        (structure.unassigned || []).filter((a) => userRole?.employeeId && a.id === userRole.employeeId)
      );
      return { ...structure, units: [], unassigned };
    }
    const units = mapTeamsFiltered(
      (structure.units || []).map((section) => ({
        ...section,
        teams: (section.teams || []).filter((t) => [...names].some((vn) => teamsMatch(t.name, vn))),
      }))
    );
    return { ...structure, units, unassigned: [] };
  }

  if (role === "agent" || role === "office_assistant") {
    const names = visibleTeamNames();
    if (!names.size) {
      const unassigned = filterAgentsByAccess(
        (structure.unassigned || []).filter((a) => userRole?.employeeId && a.id === userRole.employeeId)
      );
      return { ...structure, units: [], unassigned };
    }
    const units = mapTeamsFiltered(
      (structure.units || []).map((section) => ({
        ...section,
        teams: (section.teams || []).filter((t) => [...names].some((vn) => teamsMatch(t.name, vn))),
      }))
    );
    return { ...structure, units, unassigned: [] };
  }

  return structure;
}

function filterOrgStructureForAgent(structure, userRole) {
  return filterOrgStructureForRole(structure, userRole);
}

module.exports = {
  CLEARANCE_KEYS,
  ORG_STRUCTURE,
  readAllEmploymentPeriods,
  getEmploymentPeriods,
  addEmploymentPeriod,
  closeEmploymentPeriod,
  reopenEmploymentPeriod,
  readAllActionPlans,
  getActionPlans,
  getActionPlan,
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
  hasOpenEquipmentAssignment,
  syncEquipmentHandover,
  buildClearanceBoard,
  deriveEquipmentHandover: equipmentClearance.deriveEquipmentHandover,
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
  getAppSessionRow,
  revokeOtherSessionsForUser,
  getAppUserPasswordChangedAt,
  getOrgStructure,
  getLiveOrgStructure,
  filterOrgStructureForRole,
  filterOrgStructureForAgent,
  buildLiveOrgStructure,
  readOrgTeams,
  createOrgTeam,
  updateOrgTeam,
  relocateTeamToUnit,
  deleteOrgTeam,
  buildOrgByUnits,
  readOrgUnits,
  createOrgUnit,
  deleteOrgUnit,
  ORG_UNITS,
};
