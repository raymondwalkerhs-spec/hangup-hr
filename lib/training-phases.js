/**
 * Agent training: 4 working weeks (Mon–Fri), status per phase, sales counts.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

const PHASE_STATUSES = ["pending", "passed", "rejected", "passed_exception"];
const STATUS_LABELS = {
  pending: "Pending",
  passed: "Passed",
  rejected: "Rejected",
  passed_exception: "Passed (Exception)",
};

function db() {
  return getSupabaseAdmin();
}

function requireSupabase() {
  if (!useSupabase()) throw new Error("Requires DATA_BACKEND=supabase");
}

function parseDate(s) {
  const d = String(s || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the calendar week containing dateStr. */
function mondayOfWeek(dateStr) {
  const d = new Date(`${parseDate(dateStr)}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function fridayOfWeek(mondayStr) {
  return addDays(mondayStr, 4);
}

function buildPhaseWeeks(phase1Start) {
  const start = mondayOfWeek(phase1Start);
  const phases = [];
  let weekStart = start;
  for (let n = 1; n <= 4; n++) {
    phases.push({
      phaseNumber: n,
      weekStart,
      weekEnd: fridayOfWeek(weekStart),
      status: "pending",
    });
    weekStart = addDays(weekStart, 7);
  }
  return phases;
}

function mapPhase(row, salesCounts = {}) {
  const key = row.phase_number;
  const counts = salesCounts[key] || { passed: 0, total: 0 };
  return {
    id: row.id,
    employeeId: row.employee_id,
    phaseNumber: row.phase_number,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    notes: row.notes || "",
    salesPassed: counts.passed,
    salesTotal: counts.total,
    updatedAt: row.updated_at,
  };
}

async function countSalesForPhases(employeeId, phases) {
  if (!phases.length) return {};
  const from = phases.reduce((m, p) => (p.week_start < m ? p.week_start : m), phases[0].week_start);
  const to = phases.reduce((m, p) => (p.week_end > m ? p.week_end : m), phases[0].week_end);
  const business = require("./business-repo");
  let sales = [];
  try {
    sales = await business.readSales({
      from,
      to,
      agentId: employeeId,
      dateBasis: "submission",
    });
  } catch {
    sales = [];
  }
  const out = {};
  for (const ph of phases) {
    const inRange = sales.filter((s) => {
      const d = s.submissionDate || s.effectiveDate || "";
      return d >= ph.week_start && d <= ph.week_end;
    });
    out[ph.phase_number] = {
      passed: inRange.filter((s) => s.status === "passed").length,
      total: inRange.length,
    };
  }
  return out;
}

async function getProgram(employeeId, { withSales = true } = {}) {
  requireSupabase();
  const { data: prog, error: pErr } = await db()
    .from("agent_training_programs")
    .select("*")
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!prog) return null;

  const { data: phases, error } = await db()
    .from("agent_training_phases")
    .select("*")
    .eq("employee_id", employeeId)
    .order("phase_number");
  if (error) throw new Error(error.message);

  const salesCounts = withSales ? await countSalesForPhases(employeeId, phases || []) : {};
  const mapped = (phases || []).map((r) => mapPhase(r, salesCounts));

  const rejectedAt = mapped.find((p) => p.status === "rejected");
  const visiblePhases = rejectedAt
    ? mapped.filter((p) => p.phaseNumber <= rejectedAt.phaseNumber)
    : mapped;

  return {
    employeeId,
    active: prog.active === true,
    phase1Start: prog.phase1_start,
    phases: visiblePhases,
    allPhases: mapped,
    rejectedAtPhase: rejectedAt?.phaseNumber || null,
    createdAt: prog.created_at,
    updatedAt: prog.updated_at,
  };
}

async function createProgram(employeeId, phase1Start, actor) {
  requireSupabase();
  const start = mondayOfWeek(phase1Start);
  const existing = await getProgram(employeeId, { withSales: false });
  if (existing) throw new Error("Training program already exists for this employee");

  const { error: pErr } = await db().from("agent_training_programs").insert({
    employee_id: employeeId,
    active: true,
    phase1_start: start,
    updated_by: actor,
    updated_at: new Date().toISOString(),
  });
  if (pErr) throw new Error(pErr.message);

  const weeks = buildPhaseWeeks(start);
  const rows = weeks.map((w) => ({
    employee_id: employeeId,
    phase_number: w.phaseNumber,
    week_start: w.weekStart,
    week_end: w.weekEnd,
    status: w.status,
    updated_by: actor,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db().from("agent_training_phases").insert(rows);
  if (error) throw new Error(error.message);
  return getProgram(employeeId);
}

async function updatePhase(phaseId, patch, actor) {
  requireSupabase();
  const { data: current, error: gErr } = await db()
    .from("agent_training_phases")
    .select("*")
    .eq("id", phaseId)
    .maybeSingle();
  if (gErr) throw new Error(gErr.message);
  if (!current) throw new Error("Training phase not found");

  const row = { updated_by: actor, updated_at: new Date().toISOString() };
  if (patch.status !== undefined) {
    const st = String(patch.status).toLowerCase();
    if (!PHASE_STATUSES.includes(st)) throw new Error(`Invalid status: ${patch.status}`);
    row.status = st;
  }
  if (patch.weekStart !== undefined) {
    const ws = parseDate(patch.weekStart);
    if (!ws) throw new Error("Invalid week start");
    row.week_start = mondayOfWeek(ws);
    row.week_end = fridayOfWeek(row.week_start);
  }
  if (patch.weekEnd !== undefined) {
    const we = parseDate(patch.weekEnd);
    if (!we) throw new Error("Invalid week end");
    row.week_end = we;
  }
  if (patch.notes !== undefined) row.notes = String(patch.notes || "").trim() || null;

  const { data, error } = await db()
    .from("agent_training_phases")
    .update(row)
    .eq("id", phaseId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  if (patch.weekStart !== undefined && patch.recalculateFollowing) {
    await recalculateFollowingPhases(current.employee_id, data.phase_number, data.week_start, actor);
  }

  if (data.phase_number === 1 && patch.weekStart !== undefined) {
    await db()
      .from("agent_training_programs")
      .update({
        phase1_start: data.week_start,
        updated_by: actor,
        updated_at: new Date().toISOString(),
      })
      .eq("employee_id", current.employee_id);
  }

  return getProgram(current.employee_id);
}

async function recalculateFollowingPhases(employeeId, fromPhaseNumber, fromWeekStart, actor) {
  let weekStart = mondayOfWeek(fromWeekStart);
  for (let n = fromPhaseNumber + 1; n <= 4; n++) {
    weekStart = addDays(weekStart, 7);
    await db()
      .from("agent_training_phases")
      .update({
        week_start: weekStart,
        week_end: fridayOfWeek(weekStart),
        updated_by: actor,
        updated_at: new Date().toISOString(),
      })
      .eq("employee_id", employeeId)
      .eq("phase_number", n);
  }
}

async function recalculateFromPhase(employeeId, fromPhaseNumber, actor) {
  const { data: phase } = await db()
    .from("agent_training_phases")
    .select("week_start")
    .eq("employee_id", employeeId)
    .eq("phase_number", fromPhaseNumber)
    .maybeSingle();
  if (!phase) throw new Error("Phase not found");
  await recalculateFollowingPhases(employeeId, fromPhaseNumber, phase.week_start, actor);
  return getProgram(employeeId);
}

async function setProgramActive(employeeId, active, actor) {
  requireSupabase();
  const { error } = await db()
    .from("agent_training_programs")
    .update({ active: active === true, updated_by: actor, updated_at: new Date().toISOString() })
    .eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
  return getProgram(employeeId);
}

module.exports = {
  PHASE_STATUSES,
  STATUS_LABELS,
  mondayOfWeek,
  fridayOfWeek,
  buildPhaseWeeks,
  getProgram,
  createProgram,
  updatePhase,
  recalculateFromPhase,
  setProgramActive,
};
