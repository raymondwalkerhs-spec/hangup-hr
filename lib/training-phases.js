/**
 * Agent training: 4 working weeks (Mon–Fri), status per phase, sales counts.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");

const {
  PROGRAM_OUTCOMES,
  PHASE_EXIT_REASONS,
  MIN_SALES_PER_PHASE,
  MIN_SALES_PROGRAM,
  evaluateProgramSales,
  validatePhaseSales,
  trainingPayPreview,
} = require("./training-pay-rules");

const PHASE_STATUSES = ["pending", "passed", "rejected", "passed_exception"];
const STATUS_LABELS = {
  pending: "Pending",
  passed: "Passed",
  rejected: "Rejected",
  passed_exception: "Passed (Exception)",
};
const OUTCOME_LABELS = {
  active: "Active",
  passed: "Passed",
  failed: "Failed",
  voluntary_leave: "Agent left",
  company_terminated: "Company terminated",
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
    exitReason: row.exit_reason || "none",
    minSalesRequired: row.min_sales_required ?? MIN_SALES_PER_PHASE,
    salesPassed: counts.passed,
    salesTotal: counts.total,
    updatedAt: row.updated_at,
  };
}

function mapProgramRow(prog) {
  if (!prog) return null;
  return {
    outcome: prog.outcome || "active",
    outcomeLabel: OUTCOME_LABELS[prog.outcome] || prog.outcome || "Active",
    passedOnDate: prog.passed_on_date || null,
    promotionEffectiveDate: prog.promotion_effective_date || null,
    phase2FirstLoginDate: prog.phase2_first_login_date || null,
    exitNotes: prog.exit_notes || "",
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

  const salesEval = evaluateProgramSales(mapped);
  const meta = mapProgramRow(prog);

  return {
    employeeId,
    active: prog.active === true,
    phase1Start: prog.phase1_start,
    phases: visiblePhases,
    allPhases: mapped,
    rejectedAtPhase: rejectedAt?.phaseNumber || null,
    createdAt: prog.created_at,
    updatedAt: prog.updated_at,
    ...meta,
    salesEvaluation: salesEval,
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

  await db()
    .from("employees")
    .update({ position: "Trainee", updated_at: new Date().toISOString() })
    .eq("id", employeeId);

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
  if (patch.exitReason !== undefined) {
    const er = String(patch.exitReason).toLowerCase();
    if (!PHASE_EXIT_REASONS.includes(er)) throw new Error(`Invalid exit reason: ${patch.exitReason}`);
    row.exit_reason = er;
  }
  if (patch.minSalesRequired !== undefined) {
    row.min_sales_required = Math.max(0, Number(patch.minSalesRequired) || MIN_SALES_PER_PHASE);
  }

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

async function updateProgramOutcome(employeeId, patch, actor) {
  requireSupabase();
  const program = await getProgram(employeeId);
  if (!program) throw new Error("Training program not found");

  const row = { updated_by: actor, updated_at: new Date().toISOString() };
  if (patch.outcome !== undefined) {
    const o = String(patch.outcome).toLowerCase();
    if (!PROGRAM_OUTCOMES.includes(o)) throw new Error(`Invalid outcome: ${patch.outcome}`);
    row.outcome = o;
  }
  if (patch.passedOnDate !== undefined) {
    row.passed_on_date = patch.passedOnDate ? parseDate(patch.passedOnDate) : null;
  }
  if (patch.promotionEffectiveDate !== undefined) {
    row.promotion_effective_date = patch.promotionEffectiveDate
      ? parseDate(patch.promotionEffectiveDate)
      : null;
  }
  if (patch.phase2FirstLoginDate !== undefined) {
    row.phase2_first_login_date = patch.phase2FirstLoginDate
      ? parseDate(patch.phase2FirstLoginDate)
      : null;
  }
  if (patch.exitNotes !== undefined) {
    row.exit_notes = String(patch.exitNotes || "").trim() || null;
  }

  const { error } = await db().from("agent_training_programs").update(row).eq("employee_id", employeeId);
  if (error) throw new Error(error.message);
  return getProgram(employeeId);
}

async function promoteToAgent(employeeId, { promotionDate, passedOnDate } = {}, actor) {
  requireSupabase();
  const program = await getProgram(employeeId);
  if (!program) throw new Error("Training program not found");
  const evalSales = program.salesEvaluation || evaluateProgramSales(program.allPhases || []);
  if (!evalSales.meetsMinimum12 && !program.allPhases?.some((p) => p.status === "passed_exception")) {
    throw new Error(`Minimum ${MIN_SALES_PROGRAM} passed sales required (currently ${evalSales.totalPassed})`);
  }

  const promo = parseDate(promotionDate) || parseDate(passedOnDate) || new Date().toISOString().slice(0, 10);
  const passed = parseDate(passedOnDate) || promo;

  await db()
    .from("agent_training_programs")
    .update({
      outcome: "passed",
      active: false,
      passed_on_date: passed,
      promotion_effective_date: promo,
      updated_by: actor,
      updated_at: new Date().toISOString(),
    })
    .eq("employee_id", employeeId);

  await db()
    .from("employees")
    .update({
      position: "Agent",
      training_passed: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", employeeId);

  return getProgram(employeeId);
}

async function getTrainingPayPreview(employeeId, yearMonth, { attendance = [], traineeDailyRate = 0 } = {}) {
  const program = await getProgram(employeeId);
  if (!program) return null;
  return trainingPayPreview(program, attendance, yearMonth, traineeDailyRate);
}

async function loadProgramsForEmployees(employeeIds) {
  requireSupabase();
  if (!employeeIds?.length) return new Map();
  const { data: progs, error } = await db()
    .from("agent_training_programs")
    .select("*")
    .in("employee_id", employeeIds);
  if (error) throw new Error(error.message);
  const map = new Map();
  for (const id of employeeIds) {
    try {
      map.set(id, await getProgram(id));
    } catch {
      map.set(id, null);
    }
  }
  return map;
}

module.exports = {
  PHASE_STATUSES,
  STATUS_LABELS,
  PROGRAM_OUTCOMES,
  PHASE_EXIT_REASONS,
  OUTCOME_LABELS,
  MIN_SALES_PER_PHASE,
  MIN_SALES_PROGRAM,
  mondayOfWeek,
  fridayOfWeek,
  buildPhaseWeeks,
  getProgram,
  createProgram,
  updatePhase,
  recalculateFromPhase,
  setProgramActive,
  updateProgramOutcome,
  promoteToAgent,
  getTrainingPayPreview,
  loadProgramsForEmployees,
  evaluateProgramSales,
  validatePhaseSales,
};
