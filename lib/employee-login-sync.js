/**
 * Keep app_users login status aligned with employee Out lifecycle status.
 * Attendance-only OUT cells do not change employee.status — only lifecycle Out disables login.
 */
const store = require("./data-store");

const OUT_STATUSES = new Set(["out", "out but still get paid"]);

function isOutStatus(status) {
  return OUT_STATUSES.has(String(status || "").trim().toLowerCase());
}

function shouldDisableLoginForEmployee(emp) {
  if (!emp) return false;
  return isOutStatus(emp.status);
}

function loginDisableWarning(result) {
  if (!result) return null;
  if (result.ok && !result.skipped) return null;
  if (result.ok && result.skipped && (result.reason === "already_inactive" || result.reason === "already_terminated")) {
    return null;
  }
  if (result.reason === "no_login" || result.reason === "no_user") {
    return "Employee marked Out but no linked login account was found.";
  }
  if (result.reason === "not_out") {
    return null;
  }
  if (result.error) return String(result.error);
  return "Login could not be deactivated automatically — retry from Users or contact IT.";
}

async function findLoginUsernameForEmployee(employeeId) {
  const usersAdmin = require("./users-admin");
  const id = String(employeeId || "").trim();
  if (!id) return null;
  const byLink = await usersAdmin.findAppUserByEmployeeId(id);
  if (byLink?.username) return byLink.username;
  const byUsername = await usersAdmin.getAppUser(id).catch(() => null);
  if (byUsername?.username) return byUsername.username;
  return null;
}

async function disableLoginForDepartedEmployee(employeeId, actor = "system") {
  const usersAdmin = require("./users-admin");
  const emp = store.getEmployeeById(employeeId);
  if (!emp || !shouldDisableLoginForEmployee(emp)) {
    return { ok: false, skipped: true, reason: "not_out" };
  }
  const username = await findLoginUsernameForEmployee(employeeId);
  if (!username) return { ok: false, skipped: true, reason: "no_login" };

  const existing = await usersAdmin.getAppUser(username);
  if (!existing) return { ok: false, skipped: true, reason: "no_user" };
  if (String(existing.status || "").toLowerCase() === "terminated") {
    return { ok: true, skipped: true, reason: "already_terminated", username };
  }
  if (String(existing.status || "").toLowerCase() === "inactive") {
    return { ok: true, skipped: true, reason: "already_inactive", username };
  }

  await usersAdmin.updateAppUser(username, { status: "inactive" }, actor, {
    skipActivateGate: true,
  });
  return { ok: true, username, previousStatus: existing.status };
}

async function disableLoginsForAllDepartedEmployees(actor = "system") {
  const employees = store.getEmployees() || [];
  const results = { disabled: [], skipped: [], errors: [] };
  for (const emp of employees) {
    if (!shouldDisableLoginForEmployee(emp)) continue;
    try {
      const r = await disableLoginForDepartedEmployee(emp.id, actor);
      if (r.ok && !r.skipped) results.disabled.push({ employeeId: emp.id, username: r.username });
      else results.skipped.push({ employeeId: emp.id, ...r });
    } catch (err) {
      results.errors.push({ employeeId: emp.id, error: err.message });
    }
  }
  return results;
}

module.exports = {
  isOutStatus,
  shouldDisableLoginForEmployee,
  loginDisableWarning,
  findLoginUsernameForEmployee,
  disableLoginForDepartedEmployee,
  disableLoginsForAllDepartedEmployees,
};
