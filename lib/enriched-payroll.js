/**
 * Shared enriched payroll pipeline (attendance, training, hybrid DB, splits).
 */
const store = require("./data-store");
const { useSupabase } = require("./backend");
const {
  summarizeEmployeeMonth,
  applyDepartAutoOutForMonth,
} = require("./attendance");
const { buildPayroll } = require("./payroll");
const { applyPayrollHybridDbToRow } = require("./payroll-hybrid");

async function loadActionPlansSafe() {
  if (!useSupabase()) return [];
  try {
    const hrms = require("./hrms-repo");
    return await hrms.readAllActionPlans();
  } catch {
    return [];
  }
}

async function loadExtraPayrollEntriesForMonth(employees, month) {
  const supabaseRepo = require("./supabase-repo");
  try {
    if (typeof supabaseRepo.readExtraPayrollEntriesForMonth === "function") {
      const ids = (employees || []).map((e) => e.id).filter(Boolean);
      return await supabaseRepo.readExtraPayrollEntriesForMonth(month, ids);
    }
  } catch (err) {
    console.warn("[payroll] batched extra payroll read failed, falling back:", err.message);
  }
  const entries = await Promise.all(
    (employees || []).map((emp) =>
      supabaseRepo.readExtraPayrollEntries(emp.id, month).catch(() => [])
    )
  );
  return entries.flat();
}

async function resolvePayrollConfig(month, company = "hangup") {
  const workingDays = await store.getWorkingDaysForMonth(month);
  const base = store.getConfigForCompany(company);
  const config = {
    ...base,
    workingDaysByMonth: {
      ...(base.workingDaysByMonth || {}),
      [month]: workingDays,
    },
  };
  return { config, workingDays };
}

async function enrichPayrollWithTraining(payroll, employees, month, ctx) {
  if (!useSupabase()) return { payroll, trainingEnrichWarnings: [] };
  try {
    const trainingPhases = require("./training-phases");
    const { enrichPayrollRows, buildProgramPayrollDataForEmployees } = require("./training-payroll");
    const programs =
      ctx.programs ||
      (await trainingPhases.loadProgramsForEmployees(employees.map((e) => e.id), {
        withSales: false,
      }));
    const programPayrollByEmployee = buildProgramPayrollDataForEmployees(programs, {
      getAttendance: (ym, empId) => store.getAttendanceEvents(ym).filter((r) => r.employeeId === empId),
      getBonuses: (ym, empId) => store.getBonusEvents(ym, empId),
      getDeductions: (ym, empId) => store.getDeductionEvents(ym, empId),
    });
    const enriched = enrichPayrollRows(
      payroll,
      employees,
      {
        ym: month,
        ...ctx,
        actionPlans: ctx.actionPlans || [],
        attendanceByEmployee: ctx.attendanceMap,
        adjustments: ctx.adjustments || [],
      },
      programs,
      programPayrollByEmployee
    );
    const warnings = [];
    const empById = new Map(employees.map((e) => [e.id, e]));
    for (const [empId, program] of programs) {
      if ((program.outcome || "active") !== "active") continue;
      const phases = program.allPhases || program.phases || [];
      const ph4 = phases.find((p) => (p.phaseNumber ?? p.phase_number) === 4);
      const ph4End = ph4?.weekEnd || ph4?.week_end;
      if (!ph4End) {
        const name = empById.get(empId)?.american_name || empId;
        warnings.push(
          `${name} (${empId}): training program missing phase 4 — set Training anchor month on payslip if pay month is wrong`
        );
      }
    }
    return { payroll: enriched, trainingEnrichWarnings: warnings };
  } catch (err) {
    console.warn("training payroll batch enrich failed:", err.message);
    return {
      payroll,
      trainingEnrichWarnings: [`Training payroll enrichment failed: ${err.message}`],
    };
  }
}

async function loadProgramsForEmployees(employees) {
  if (!useSupabase()) return new Map();
  try {
    const trainingPhases = require("./training-phases");
    return trainingPhases.loadProgramsForEmployees(employees.map((e) => e.id), { withSales: false });
  } catch {
    return new Map();
  }
}

async function buildForEmployees(month, employees, company = "hangup", opts = {}) {
  const co = company === "hs2" ? "hs2" : "hangup";
  const rates = store.getPositionRates(month);
  if (!opts.skipAttendanceRefresh) {
    await store.refreshAttendanceFromSupabase(month);
  }

  const live = useSupabase();
  const [configBundle, actionPlans, extraEntries, programs, dbCore] = await Promise.all([
    resolvePayrollConfig(month, co),
    loadActionPlansSafe(),
    live ? loadExtraPayrollEntriesForMonth(employees, month) : Promise.resolve([]),
    live ? loadProgramsForEmployees(employees) : Promise.resolve(new Map()),
    live ? store.getPayrollCoreFromDb(month).catch(() => null) : Promise.resolve(null),
  ]);
  const { config, workingDays } = configBundle;

  let records = store.getAttendanceEvents(month);
  records = applyDepartAutoOutForMonth(employees, records, month);
  const bonusEvents = store.getBonusEvents(month);
  const deductionEvents = store.getDeductionEvents(month);
  const adjustments = store.getPayrollAdjustments(month);
  const attendanceMap = store.buildAttendanceMap(month);
  const {
    commissionTiers,
    loans,
    loanPayments,
    loanMonthOverrides = [],
    loanScheduleLines = [],
  } = store.getPayrollExtras(month, co);
  const allPayrollSplits = store.getAllPayrollSplits();
  const actionPlansByEmployee = new Map();
  for (const p of actionPlans) {
    if (p.status !== "active") continue;
    if (!actionPlansByEmployee.has(p.employeeId)) actionPlansByEmployee.set(p.employeeId, []);
    actionPlansByEmployee.get(p.employeeId).push(p);
  }
  const recordsByEmployee = new Map();
  for (const r of records) {
    if (!recordsByEmployee.has(r.employeeId)) recordsByEmployee.set(r.employeeId, []);
    recordsByEmployee.get(r.employeeId).push(r);
  }

  const summaries = employees.map((emp) =>
    summarizeEmployeeMonth(
      emp,
      recordsByEmployee.get(emp.id) || [],
      config,
      actionPlansByEmployee.get(emp.id) || []
    )
  );

  let payroll = buildPayroll(
    employees,
    summaries,
    month,
    config,
    rates,
    bonusEvents,
    deductionEvents,
    adjustments,
    attendanceMap,
    commissionTiers,
    loans,
    loanPayments,
    allPayrollSplits,
    actionPlans,
    new Map(),
    extraEntries,
    loanMonthOverrides,
    loanScheduleLines
  );

  const trainingEnrich = await enrichPayrollWithTraining(payroll, employees, month, {
    config,
    rates,
    bonusEvents,
    deductionEvents,
    adjustments,
    attendanceMap,
    commissionTiers,
    loans,
    loanPayments,
    allPayrollSplits,
    actionPlans,
    programs,
  });
  payroll = trainingEnrich.payroll;

  if (live) {
    try {
      if (Array.isArray(dbCore) && dbCore.length > 0) {
        const allZeroWorkingDays = dbCore.every((r) => Number(r.working_days) === 0);
        if (allZeroWorkingDays) {
          console.log(
            `[payroll-hybrid] Skipping DB merge for ${month}: all ${dbCore.length} core rows have working_days=0`
          );
        } else {
          const dbMap = new Map(dbCore.map((r) => [r.employee_id, r]));
          payroll = payroll.map((row) => {
            const dbRow = dbMap.get(row.employeeId);
            if (!dbRow) return row;
            return applyPayrollHybridDbToRow(row, dbRow);
          });
          console.log(`[payroll-hybrid] DB core calc applied for ${dbCore.length} employees in ${month}`);
        }
      }
    } catch (err) {
      console.warn("[payroll-hybrid] DB core calc failed, using app layer:", err.message);
    }
  }

  return {
    payroll,
    employees,
    config,
    workingDays,
    commissionTiers,
    allPayrollSplits,
    rates,
    bonusEvents,
    deductionEvents,
    adjustments,
    attendanceMap,
    loans,
    loanPayments,
    actionPlans,
    trainingEnrichWarnings: trainingEnrich.trainingEnrichWarnings || [],
  };
}

module.exports = {
  buildForEmployees,
  enrichPayrollWithTraining,
  loadProgramsForEmployees,
  resolvePayrollConfig,
  loadExtraPayrollEntriesForMonth,
};
