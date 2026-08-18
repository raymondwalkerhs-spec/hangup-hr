/**
 * Pure helpers for equipment handover + clearance payroll gates.
 * No I/O — used by hrms-repo, payroll-gates, and unit tests.
 */

const { parseFormerIds } = require("./employee-ids");

const FORM_FILE_KEYS = ["clearance_form", "files_handover"];

function deriveEquipmentHandover(assignments) {
  const list = Array.isArray(assignments) ? assignments : [];
  const unreturned = list.filter((a) => !a.returnedAt && !a.returned_at);
  if (unreturned.length) return "pending";
  if (list.length) return "done";
  return "not_needed";
}

function isSettledClearanceStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "done" || s === "not_needed" || s === "completed";
}

function pendingFormOrFiles(clearance) {
  return (clearance || []).filter((c) => {
    const key = c.itemKey || c.item_key;
    if (!FORM_FILE_KEYS.includes(key)) return false;
    return String(c.status || "pending").toLowerCase() === "pending";
  });
}

function unreturnedAssignments(assignments) {
  return (assignments || []).filter((a) => !a.returnedAt && !a.returned_at);
}

function isClearanceComplete(clearance, assignments) {
  const handover = deriveEquipmentHandover(assignments);
  if (handover === "pending") return false;
  return pendingFormOrFiles(clearance).length === 0;
}

function isPayrollReady(clearance, assignments, offboarding) {
  if (!isClearanceComplete(clearance, assignments)) return false;
  return offboarding?.finalPay === true || offboarding?.final_pay === true;
}

function buildPayrollBlockers({ offboarding, clearance, equipment, readFailed }) {
  if (readFailed) {
    return {
      blocked: true,
      blockers: ["read_failed"],
      payslipNotes: ["Could not verify offboarding, clearance, or equipment — cannot approve final pay."],
      offboarding: offboarding || { finalPay: false, revokeAccess: false },
      clearance: clearance || [],
      unreturnedEquipment: [],
    };
  }

  const blockers = [];
  const notes = [];
  const pending = pendingFormOrFiles(clearance);
  if (pending.length) {
    blockers.push("clearance_pending");
    notes.push("Clearance form pending — employee must complete handover before final pay approval.");
  }

  const unreturned = unreturnedAssignments(equipment);
  if (unreturned.length) {
    blockers.push("equipment_outstanding");
    const list = unreturned
      .map((a) => `${a.assetTag || a.asset_tag || a.description || "item"} (${a.itemType || a.item_type || "item"})`)
      .join(", ");
    notes.push(`Equipment not returned: ${list}`);
  }

  const clearanceForm = (clearance || []).find((c) => (c.itemKey || c.item_key) === "clearance_form");
  if (String(clearanceForm?.status || "").toLowerCase() === "pending") {
    notes.push("Employee needs to hand over clearance form.");
  }

  return {
    blocked: blockers.includes("clearance_pending") || blockers.includes("equipment_outstanding"),
    blockers,
    payslipNotes: notes,
    offboarding: offboarding || { finalPay: false, revokeAccess: false },
    clearance: clearance || [],
    unreturnedEquipment: unreturned,
  };
}

function isUniqueViolation(error) {
  if (!error) return false;
  if (String(error.code || "") === "23505") return true;
  return /duplicate key|unique constraint|already has an open assignment/i.test(String(error.message || ""));
}

function chunkIds(ids, size = 100) {
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function employeeEquipmentLookupIds(emp) {
  if (!emp) return [];
  const ids = new Set();
  if (emp.id) ids.add(String(emp.id));
  if (emp.employeeId) ids.add(String(emp.employeeId));
  parseFormerIds(emp.former_ids || emp.formerIds).forEach((id) => ids.add(String(id)));
  if (emp.archived_app_id) ids.add(String(emp.archived_app_id));
  if (emp.archivedAppId) ids.add(String(emp.archivedAppId));
  return [...ids].filter(Boolean);
}

function coalesceCompany(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "hs2") return "hs2";
  return "hangup";
}

module.exports = {
  FORM_FILE_KEYS,
  deriveEquipmentHandover,
  isSettledClearanceStatus,
  pendingFormOrFiles,
  unreturnedAssignments,
  isClearanceComplete,
  isPayrollReady,
  buildPayrollBlockers,
  isUniqueViolation,
  chunkIds,
  employeeEquipmentLookupIds,
  coalesceCompany,
};
