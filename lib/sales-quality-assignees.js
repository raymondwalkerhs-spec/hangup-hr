/**
 * Quality ticket assignee validation (reviewer / verifier).
 * Mirrors legacy sales.js picker rules; reviewers are quality / RTM / admin only.
 */

const REVIEWER_ROLES = new Set(["quality", "rtm", "admin", "ceo"]);

function isOutStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  return s === "out" || s.includes("out");
}

function resolveEmployeeRole(emp) {
  if (!emp) return "";
  try {
    const { lookupLiveAppRole, inferAppRoleForEmployee } = require("./employee-app-role");
    const live = lookupLiveAppRole(emp);
    if (live) return live;
    return inferAppRoleForEmployee(emp);
  } catch {
    return String(emp.role || "").toLowerCase();
  }
}

function isEligibleQualityReviewer(emp) {
  if (!emp || isOutStatus(emp.status)) return false;
  try {
    const { isEligibleReviewerEmployee } = require("./employee-app-role");
    if (isEligibleReviewerEmployee(emp)) return true;
  } catch {
    /* fall through */
  }
  const role = resolveEmployeeRole(emp);
  return REVIEWER_ROLES.has(role);
}

function isEligibleVerifier(emp) {
  if (!emp || isOutStatus(emp.status)) return false;
  const role = resolveEmployeeRole(emp);
  if (["quality", "rtm", "tl", "op", "admin", "ceo"].includes(role)) return true;
  if (role && role !== "agent" && role !== "none") return false;
  const id = String(emp.id || "");
  if (!role && /^(TL|CL|OP|HR|QA|RTM|MG)/i.test(id)) return true;
  return false;
}

function isNonDialingReviewer(emp) {
  if (!emp || !isEligibleQualityReviewer(emp)) return false;
  try {
    const { isDialingAgent } = require("./dialing-agents");
    return !isDialingAgent(emp);
  } catch {
    return true;
  }
}

function validateQualityAssignees(formData, getEmployeeById) {
  for (const [key, label, check] of [
    ["reviewer", "Reviewer", isEligibleQualityReviewer],
    ["assignVerifier", "Verifier", isEligibleVerifier],
  ]) {
    const id = String(formData?.[key] || "").trim();
    if (!id) continue;
    const emp = getEmployeeById(id);
    if (!emp) return { ok: false, error: `${label} not found` };
    if (isOutStatus(emp.status)) {
      return { ok: false, error: `${label} is out and cannot be assigned` };
    }
    if (!check(emp)) {
      return { ok: false, error: `${label} must be a valid ${key === "reviewer" ? "quality, RTM, or admin" : "verifier"} user` };
    }
  }
  return { ok: true };
}

module.exports = {
  REVIEWER_ROLES,
  isEligibleQualityReviewer,
  isEligibleVerifier,
  isNonDialingReviewer,
  validateQualityAssignees,
};
