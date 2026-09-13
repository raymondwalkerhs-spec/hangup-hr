/**
 * Agent training: 4 working weeks (Mon–Fri), status per phase, sales counts.
 */
const { getSupabaseAdmin } = require("./supabase-client");
const { useSupabase } = require("./backend");
const {
  parseIsoDate,
  addCalendarDays,
  mondayOfWeek: mondayOfIsoWeek,
  fridayOfWeek: fridayOfIsoWeek,
  todayLocalIsoDate,
} = require("./date-iso");

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
  return parseIsoDate(s) || null;
}

function addDays(dateStr, days) {
  const out = addCalendarDays(parseDate(dateStr) || dateStr, days);
  if (!out) throw new Error("Invalid date");
  return out;
}

/** Monday of the calendar week containing dateStr. */
function mondayOfWeek(dateStr) {
  const mon = mondayOfIsoWeek(parseDate(dateStr) || dateStr);
  if (!mon) throw new Error("Invalid date");
  return mon;
}

function fridayOfWeek(mondayStr) {
  const fri = fridayOfIsoWeek(mondayStr);
  if (!fri) throw new Error("Invalid date");
  return fri;
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

/**
 * Hang-Up / MLA → sales table; HS-2 / RPM → rpm_sales.
 * Pure helper for tests and countSalesForPhases.
 */
function resolveTrainingSalesProgram(employee) {
  const companyCtx = require("./company-context");
  if (!employee) return "mla";
  if (companyCtx.isInHs2Scope(employee) || companyCtx.getCompanyForUnit(employee.unit) === "hs2") {
    return "rpm";
  }
  return "mla";
}

/** Bucket normalized sales rows into per-phase passed/total counts. */
function bucketSalesIntoPhases(sales, phases) {
  const out = {};
  for (const ph of phases || []) {
    const ws = ph.week_start || ph.weekStart;
    const we = ph.week_end || ph.weekEnd;
    const n = ph.phase_number ?? ph.phaseNumber;
    const inRange = (sales || []).filter((s) => {
      const d = String(s.submissionDate || s.effectiveDate || "").slice(0, 10);
      return d && ws && we && d >= ws && d <= we;
    });
    out[n] = {
      passed: inRange.filter((s) => String(s.status || "").toLowerCase() === "passed").length,
      total: inRange.length,
    };
  }
  return out;
}

async function countSalesForPhases(employeeId, phases, employeeHint = null) {
  if (!phases.length) return {};
  const from = phases.reduce((m, p) => (p.week_start < m ? p.week_start : m), phases[0].week_start);
  const to = phases.reduce((m, p) => (p.week_end > m ? p.week_end : m), phases[0].week_end);
  let emp = employeeHint;
  if (!emp) {
    try {
      emp = require("./data-store").getEmployeeById(employeeId);
    } catch {
      emp = null;
    }
  }
  const program = resolveTrainingSalesProgram(emp);
  let sales = [];
  try {
    if (program === "rpm") {
      const rpmRepo = require("./rpm-sales-repo");
      sales = await rpmRepo.readRpmSales({ from, to, agentId: employeeId });
    } else {
      const business = require("./business-repo");
      sales = await business.readSales({
        from,
        to,
        agentId: employeeId,
        dateBasis: "submission",
      });
    }
  } catch {
    sales = [];
  }
  return bucketSalesIntoPhases(sales, phases);
}

function assertNoPhaseOverlap(phaseRows) {
  const sorted = [...(phaseRows || [])]
    .map((p) => ({
      phase_number: p.phase_number ?? p.phaseNumber,
      week_start: p.week_start || p.weekStart,
      week_end: p.week_end || p.weekEnd,
    }))
    .filter((p) => p.week_start && p.week_end)
    .sort((a, b) => a.phase_number - b.phase_number);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.week_start <= b.week_end && b.week_start <= a.week_end) {
        throw new Error(
          `Phase ${a.phase_number} (${a.week_start}–${a.week_end}) overlaps phase ${b.phase_number} (${b.week_start}–${b.week_end})`
        );
      }
    }
  }
}

function assembleProgram(prog, phaseRows, salesCounts = {}) {
  const mapped = (phaseRows || []).map((r) => mapPhase(r, salesCounts));
  const rejectedAt = mapped.find((p) => p.status === "rejected");
  const visiblePhases = rejectedAt
    ? mapped.filter((p) => p.phaseNumber <= rejectedAt.phaseNumber)
    : mapped;
  const salesEval = evaluateProgramSales(mapped);
  const meta = mapProgramRow(prog);
  return {
    employeeId: prog.employee_id,
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
  return assembleProgram(prog, phases || [], salesCounts);
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

  const store = require("./data-store");
  const emp = store.getEmployeeById(employeeId);
  if (emp) {
    const empDate = String(emp.employment_date || "").slice(0, 10);
    if (!empDate || start < empDate) {
      await store.updateEmployee(employeeId, { employment_date: start }, actor);
    }
  }

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

  if (patch.weekStart !== undefined || patch.weekEnd !== undefined) {
    const { data: siblings, error: sibErr } = await db()
      .from("agent_training_phases")
      .select("*")
      .eq("employee_id", current.employee_id)
      .order("phase_number");
    if (sibErr) throw new Error(sibErr.message);
    const proposed = (siblings || []).map((p) => {
      if (p.id !== phaseId) return p;
      return {
        ...p,
        week_start: row.week_start != null ? row.week_start : p.week_start,
        week_end: row.week_end != null ? row.week_end : p.week_end,
      };
    });
    if (patch.weekStart !== undefined && patch.recalculateFollowing) {
      let weekStart = mondayOfWeek(row.week_start);
      for (let n = current.phase_number + 1; n <= 4; n++) {
        weekStart = addDays(weekStart, 7);
        const idx = proposed.findIndex((p) => p.phase_number === n);
        if (idx >= 0) {
          proposed[idx] = {
            ...proposed[idx],
            week_start: weekStart,
            week_end: fridayOfWeek(weekStart),
          };
        }
      }
    }
    assertNoPhaseOverlap(proposed);
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

function normalizeAgentPosition(position, rates = []) {
  const { agentPositionAfterTraining } = require("./position-canonical");
  return agentPositionAfterTraining(position, rates);
}

async function loadPositionRates() {
  const { data, error } = await db().from("position_rates").select("position, monthly_salary");
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    position: r.position,
    monthlySalary: Number(r.monthly_salary),
  }));
}

async function promoteToAgent(employeeId, { promotionDate, passedOnDate, exception = false } = {}, actor) {
  requireSupabase();
  const program = await getProgram(employeeId);
  if (!program) throw new Error("Training program not found");

  // Allow promotion if:
  // 1. Meets 12-sales minimum, OR
  // 2. Any phase already marked passed_exception, OR
  // 3. Explicit exception flag passed by HR/Admin
  const evalSales = program.salesEvaluation || evaluateProgramSales(program.allPhases || []);
  const hasExceptionPhase = program.allPhases?.some((p) => p.status === "passed_exception");
  if (!evalSales.meetsMinimum12 && !hasExceptionPhase && !exception) {
    throw new Error(
      `Minimum ${MIN_SALES_PROGRAM} passed sales required (currently ${evalSales.totalPassed}). ` +
      `Use "Exception" to override.`
    );
  }

  const promo = parseDate(promotionDate) || parseDate(passedOnDate) || todayLocalIsoDate();
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

/**
 * Close stale training programs when an employee is already marked graduated.
 */
async function syncTrainingGraduation(employeeId, { actor = "system", dryRun = false, rates = null } = {}) {
  requireSupabase();
  const program = await getProgram(employeeId);
  if (!program) return { updated: false, reason: "no_program" };

  const { data: empRow, error: empErr } = await db()
    .from("employees")
    .select("id, position, training_passed")
    .eq("id", employeeId)
    .maybeSingle();
  if (empErr) throw new Error(empErr.message);
  if (!empRow) return { updated: false, reason: "no_employee" };

  const outcome = program.outcome || "active";
  const phasesComplete = require("./training-pay-rules").isProgramPhasesComplete(program);
  const shouldGraduate =
    empRow.training_passed === true || outcome === "passed" || (outcome === "active" && phasesComplete);
  if (!shouldGraduate) return { updated: false, reason: "not_graduated" };

  const promo =
    parseDate(program.promotionEffectiveDate || program.promotion_effective_date) ||
    require("./training-pay-rules").inferPromotionDateFromProgram(program) ||
    todayLocalIsoDate();
  const passed = parseDate(program.passedOnDate || program.passed_on_date) || promo;
  const rateList = rates || (await loadPositionRates());
  const nextPosition = normalizeAgentPosition(empRow.position, rateList);

  if (dryRun) {
    return {
      updated: true,
      dryRun: true,
      employeeId,
      outcome: "passed",
      promotion_effective_date: promo,
      position: nextPosition,
    };
  }

  if (outcome !== "passed" || program.active) {
    const { error: progErr } = await db()
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
    if (progErr) throw new Error(progErr.message);
  }

  const empPatch = {
    training_passed: true,
    position: nextPosition,
    updated_at: new Date().toISOString(),
  };
  if (empRow.position !== nextPosition || empRow.training_passed !== true) {
    const { error: empUpErr } = await db().from("employees").update(empPatch).eq("id", employeeId);
    if (empUpErr) throw new Error(empUpErr.message);
  }

  return { updated: true, employeeId, promotion_effective_date: promo, position: nextPosition };
}

async function syncAllTrainingGraduations({ dryRun = false, actor = "system" } = {}) {
  requireSupabase();
  const rates = await loadPositionRates();
  const { data: programs, error } = await db()
    .from("agent_training_programs")
    .select("employee_id, outcome, active");
  if (error) throw new Error(error.message);

  const results = [];
  for (const prog of programs || []) {
    if (prog.outcome === "passed" && prog.active === false) continue;
    const res = await syncTrainingGraduation(prog.employee_id, { actor, dryRun, rates });
    if (res.updated) results.push(res);
  }

  const { data: passedEmps, error: empErr } = await db()
    .from("employees")
    .select("id")
    .eq("training_passed", true);
  if (empErr) throw new Error(empErr.message);
  for (const emp of passedEmps || []) {
    if (results.some((r) => r.employeeId === emp.id)) continue;
    const res = await syncTrainingGraduation(emp.id, { actor, dryRun, rates });
    if (res.updated) results.push(res);
  }
  return results;
}

async function getTrainingPayPreview(employeeId, yearMonth, { attendance = [], traineeDailyRate = 0 } = {}) {
  const program = await getProgram(employeeId);
  if (!program) return null;
  return trainingPayPreview(program, attendance, yearMonth, traineeDailyRate);
}

async function loadProgramsForEmployees(employeeIds, { withSales = false } = {}) {
  requireSupabase();
  if (!employeeIds?.length) return new Map();
  const uniqueIds = [...new Set(employeeIds.filter(Boolean))];
  const { data: progs, error } = await db()
    .from("agent_training_programs")
    .select("*")
    .in("employee_id", uniqueIds);
  if (error) throw new Error(error.message);
  const map = new Map();
  if (!progs?.length) return map;

  const programEmpIds = progs.map((p) => p.employee_id);
  const { data: phases, error: phErr } = await db()
    .from("agent_training_phases")
    .select("*")
    .in("employee_id", programEmpIds)
    .order("phase_number");
  if (phErr) throw new Error(phErr.message);

  const phasesByEmp = new Map();
  for (const ph of phases || []) {
    const id = ph.employee_id;
    if (!phasesByEmp.has(id)) phasesByEmp.set(id, []);
    phasesByEmp.get(id).push(ph);
  }

  for (const prog of progs) {
    const empId = prog.employee_id;
    const phaseRows = phasesByEmp.get(empId) || [];
    let salesCounts = {};
    if (withSales) {
      salesCounts = await countSalesForPhases(empId, phaseRows);
    }
    map.set(empId, assembleProgram(prog, phaseRows, salesCounts));
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
  syncTrainingGraduation,
  syncAllTrainingGraduations,
  getTrainingPayPreview,
  loadProgramsForEmployees,
  evaluateProgramSales,
  validatePhaseSales,
  countSalesForPhases,
  resolveTrainingSalesProgram,
  bucketSalesIntoPhases,
  assertNoPhaseOverlap,
};
