const hrms = require("./hrms-repo");
const { isOutStatus, normalizeStatusKey } = require("./employee-status");

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

  const blockers = [];
  const notes = [];

  let offboarding = { finalPay: false, revokeAccess: false };
  let clearance = [];
  let equipment = [];
  try {
    offboarding = await hrms.getOffboarding(employeeId);
    clearance = await hrms.getClearanceItems(employeeId);
    equipment = await hrms.readEquipmentAssignments(employeeId);
  } catch {
    return { blocked: false, blockers: [], payslipNotes: [] };
  }

  const pendingClearance = clearance.filter((c) => c.status === "pending");
  if (pendingClearance.length) {
    blockers.push("clearance_pending");
    notes.push("Clearance form pending — employee must complete handover before final pay approval.");
  }

  const unreturned = equipment.filter((a) => !a.returnedAt);
  if (unreturned.length) {
    blockers.push("equipment_outstanding");
    const list = unreturned.map((a) => `${a.assetTag || a.description} (${a.itemType || "item"})`).join(", ");
    notes.push(`Equipment not returned: ${list}`);
  }

  const clearanceForm = clearance.find((c) => c.itemKey === "clearance_form");
  if (clearanceForm?.status === "pending") {
    notes.push("Employee needs to hand over clearance form.");
  }

  return {
    blocked: blockers.includes("clearance_pending") || blockers.includes("equipment_outstanding"),
    blockers,
    payslipNotes: notes,
    offboarding,
    clearance,
    unreturnedEquipment: unreturned,
  };
}

async function canApprovePayrollStatus(employeeId, yearMonth, newStatus, emp) {
  const status = String(newStatus || "").toLowerCase();
  if (!["received", "closed"].includes(status)) return { ok: true };

  const gates = await getPayrollBlockers(employeeId, yearMonth, emp);
  const isOut = isOutStatus(emp?.status);

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
};
