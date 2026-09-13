/**
 * Monday (Africa/Cairo) reminder: active trainees with pending phase outcomes
 * after Friday week_end → actionKey training_phase_outcome_due.
 */
const { egyptTodayDate, partsInCairo } = require("./egypt-datetime");
const { dispatchNotification } = require("./notify-dispatch");

const ACTION_KEY = "training_phase_outcome_due";
const CHECK_MS = Number(process.env.TRAINING_PHASE_OUTCOME_NOTIFY_MS || 60 * 60 * 1000);

let timer = null;
let lastNotifiedCairoDate = null;

function cairoWeekdayShort(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    weekday: "short",
  }).format(date);
}

function isCairoMonday(date = new Date()) {
  return cairoWeekdayShort(date) === "Mon";
}

/**
 * Pure selection: active programs with outcome active and at least one pending
 * phase whose Friday week_end is strictly before today (due Friday → overdue Mon).
 *
 * @param {Array<{ employeeId: string, name?: string, active?: boolean, outcome?: string, phases?: Array<{ phaseNumber?: number, weekEnd?: string, status?: string }> }>} programs
 * @param {string} todayIso YYYY-MM-DD (Cairo)
 */
function selectProgramsNeedingOutcomeReminder(programs, todayIso) {
  const today = String(todayIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const due = [];
  for (const prog of programs || []) {
    if (prog.active !== true) continue;
    const outcome = prog.outcome || "active";
    if (outcome !== "active") continue;
    const overduePhases = (prog.phases || []).filter((p) => {
      const st = String(p.status || "").toLowerCase();
      const we = String(p.weekEnd || p.week_end || "").slice(0, 10);
      return st === "pending" && /^\d{4}-\d{2}-\d{2}$/.test(we) && we < today;
    });
    if (overduePhases.length) {
      due.push({
        employeeId: prog.employeeId || prog.employee_id,
        name: prog.name || "",
        overduePhases,
      });
    }
  }
  return due;
}

async function loadActiveTrainingProgramsForNotify() {
  const { getSupabaseAdmin } = require("./supabase-client");
  const { useSupabase } = require("./backend");
  if (!useSupabase()) return [];
  const db = getSupabaseAdmin();
  const { data: progs, error } = await db
    .from("agent_training_programs")
    .select("employee_id, active, outcome")
    .eq("active", true)
    .eq("outcome", "active");
  if (error) throw new Error(error.message);
  if (!progs?.length) return [];

  const ids = progs.map((p) => p.employee_id);
  const { data: phases, error: phErr } = await db
    .from("agent_training_phases")
    .select("employee_id, phase_number, week_end, status")
    .in("employee_id", ids);
  if (phErr) throw new Error(phErr.message);

  const phasesByEmp = new Map();
  for (const ph of phases || []) {
    if (!phasesByEmp.has(ph.employee_id)) phasesByEmp.set(ph.employee_id, []);
    phasesByEmp.get(ph.employee_id).push({
      phaseNumber: ph.phase_number,
      weekEnd: ph.week_end,
      status: ph.status,
    });
  }

  let nameById = new Map();
  try {
    const store = require("./data-store");
    for (const id of ids) {
      const emp = store.getEmployeeById(id);
      if (emp) {
        nameById.set(id, emp.american_name || emp.arabic_name || id);
      }
    }
  } catch {
    nameById = new Map();
  }

  return progs.map((p) => ({
    employeeId: p.employee_id,
    active: p.active === true,
    outcome: p.outcome || "active",
    name: nameById.get(p.employee_id) || p.employee_id,
    phases: phasesByEmp.get(p.employee_id) || [],
  }));
}

async function runTrainingPhaseOutcomeDueReminders({ force = false, now = new Date() } = {}) {
  const today = egyptTodayDate(now);
  if (!force && !isCairoMonday(now)) {
    return { skipped: true, reason: "not_monday_cairo", today };
  }
  if (!force && lastNotifiedCairoDate === today) {
    return { skipped: true, reason: "already_notified_today", today };
  }

  const programs = await loadActiveTrainingProgramsForNotify();
  const due = selectProgramsNeedingOutcomeReminder(programs, today);
  if (!due.length) {
    if (isCairoMonday(now) || force) lastNotifiedCairoDate = today;
    return { skipped: false, notified: 0, today, due: [] };
  }

  const names = due
    .slice(0, 12)
    .map((d) => d.name || d.employeeId)
    .join(", ");
  const more = due.length > 12 ? ` (+${due.length - 12} more)` : "";
  await dispatchNotification({
    actionKey: ACTION_KEY,
    title: "Training phase outcomes due",
    body: `${due.length} active trainee(s) have pending phase outcomes after Friday week end: ${names}${more}`,
    entityType: "training",
    entityId: due[0].employeeId,
    actor: "system",
    context: {},
  });
  lastNotifiedCairoDate = today;
  return { skipped: false, notified: due.length, today, due };
}

function startTrainingPhaseOutcomeNotifyLoop() {
  if (timer) return;
  const tick = () => {
    runTrainingPhaseOutcomeDueReminders().catch((err) => {
      console.warn("[training-phase-outcome-notify]", err.message || err);
    });
  };
  // Delay first check so boot/Supabase settle; then hourly (idempotent per Cairo day).
  setTimeout(tick, 15_000);
  timer = setInterval(tick, CHECK_MS);
}

function _resetNotifyStateForTests() {
  lastNotifiedCairoDate = null;
}

module.exports = {
  ACTION_KEY,
  isCairoMonday,
  cairoWeekdayShort,
  selectProgramsNeedingOutcomeReminder,
  runTrainingPhaseOutcomeDueReminders,
  startTrainingPhaseOutcomeNotifyLoop,
  loadActiveTrainingProgramsForNotify,
  _resetNotifyStateForTests,
  partsInCairo,
};
