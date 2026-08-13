/**
 * Keep app_users login status aligned with employee Out / depart_date.
 */
const store = require("./data-store");

const OUT_STATUSES = new Set(["out", "out but still get paid"]);

function isOutStatus(status) {
  return OUT_STATUSES.has(String(status || "").trim().toLowerCase());
}

function shouldDisableLoginForEmployee(emp) {
  if (!emp) return false;
  const depart = String(emp.depart_date || "").slice(0, 10);
  if (!depart) return false;
  return isOutStatus(emp.status);
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
    return { ok: false, skipped: true, reason: "not_out_with_depart" };
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
  findLoginUsernameForEmployee,
  disableLoginForDepartedEmployee,
  disableLoginsForAllDepartedEmployees,
};
