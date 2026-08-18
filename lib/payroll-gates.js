const hrms = require("./hrms-repo");
const { isOutStatus } = require("./employee-status");
const { buildPayrollBlockers } = require("./equipment-clearance");

function shouldEnforceOffboardingGates(emp, yearMonth) {
  if (!emp) return false;
  if (isOutStatus(emp.status)) return true;
  const depart = String(emp.depart_date || "").slice(0, 7);
  if (depart && depart === yearMonth) return true;
  return false;
}

async function getPayrollBlockers(employeeId, yearMonth, emp = null) {
  if (!shouldEnforceOffboardingGates(emp, yearMonth)) {
    return { blocked: false, blockers: [], payslipNotes: [] };
  }

  let offboarding = { finalPay: false, revokeAccess: false };
  let clearance = [];
  let equipment = [];
  try {
    offboarding = await hrms.getOffboarding(employeeId);
    clearance = await hrms.getClearanceItems(employeeId);
    equipment = await hrms.readEquipmentAssignments(employeeId);
  } catch {
    return buildPayrollBlockers({ readFailed: true });
  }

  return buildPayrollBlockers({ offboarding, clearance, equipment });
}

async function canApprovePayrollStatus(employeeId, yearMonth, newStatus, emp) {
  const status = String(newStatus || "").toLowerCase();
  if (!["received", "closed"].includes(status)) return { ok: true };

  const gates = await getPayrollBlockers(employeeId, yearMonth, emp);
  const isOut = isOutStatus(emp?.status);

  if (gates.blockers?.includes("read_failed")) {
    return {
      ok: false,
      error: gates.payslipNotes.join(" "),
      blockers: gates.blockers,
    };
  }

  if (isOut && !gates.offboarding?.finalPay) {
    return {
      ok: false,
      error: "Offboarding incomplete: mark Final pay in offboarding checklist before approving payslip.",
    };
  }

  if (gates.blocked) {
    return {
      ok: false,
      error: gates.payslipNotes.join(" "),
      blockers: gates.blockers,
    };
  }

  return { ok: true, payslipNotes: gates.payslipNotes };
}

module.exports = {
  getPayrollBlockers,
  canApprovePayrollStatus,
  shouldEnforceOffboardingGates,
  buildPayrollBlockers,
};
